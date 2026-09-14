# Leaderboards + Beat-my-score

Per-video leaderboards backed by Cloud Functions, a 24 h daily-challenge
board, a minimal follow graph, and shareable "beat my score" cards that deep
link into the level. This replaces the simulated Home leaderboard (cohorts,
`advanceSimulatedCohort`, fabricated runner counts), which is gone.

## Where things live

| Area | Path |
| --- | --- |
| Shared scoring / validation (no deps) | `shared/scoring/*.ts` — `beatmap`, `grading`, `daily`, `levelIds`, `username`, `submission` |
| Cloud Functions | `functions/src/index.ts`, `functions/README.md` |
| Rules / indexes / hosting | `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `web/` |
| Client data layer | `src/lib/leaderboards.ts`, `src/lib/profileSync.ts`, `src/lib/functionsClient.ts`, `src/lib/runSubmission.ts`, `src/lib/communityActivity.ts` |
| Deep links | `src/lib/challengeLinks.ts`, `src/lib/pendingDeepLink.ts`, `src/app/l/[id].tsx`, `src/app/_layout.tsx` |
| UI | `src/app/leaderboard/[id].tsx`, `src/app/runner/[uid].tsx`, `src/app/find-friends.tsx`, `src/app/edit-username.tsx`, `src/components/DailyChallengeBoard.tsx`, `src/components/LeaderboardRow.tsx`, `src/components/ShareScoreCard.tsx` |
| Admin | `scripts/publish-beatmap.ts` |
| Tests | `npm run test:submit-validation`, `npm run test:daily-key` |

The app imports the shared package through the `@shared/*` path alias
(`tsconfig.json`; Metro resolves it via `tsconfigPaths`). `src/lib/beatmaps.ts`,
`src/lib/cueScoring.ts` and `src/lib/username.ts` re-export from it so
existing import paths keep working. Functions import it relatively
(`../../shared/scoring`) and `functions/tsconfig.json` compiles both trees
into `lib/`.

## Data model

```
beatmaps/{levelId}                {version, levelId, videoDurationSec, orientation, cues[], hash, publishedAt}
runNonces/{nonce}                 {uid, levelId, beatmapHash, issuedAt, used, usedAt?, runId?}
rateLimits/{uid}                  {dayKey, startCount, submitCount, lastAcceptedAt, lastAcceptedElapsed}
submissions/{runId}               full accepted payload + replay totals (audit; server-only)
leaderboards/{levelId}/entries/{uid}
                                  {uid, score, accuracy, maxCombo, at, recorded, runId, username,
                                   photoURL, classKey, level, playbackRate, elapsedSeconds}
dailyLeaderboards/{dateKey}/entries/{uid}
                                  same + {levelId, dateKey, expiresAt}        ← TTL field
challenges/{runId}                {uid, username, levelId, score, accuracy, maxCombo, at, recorded}
profiles/{uid}                    {username*, photoURL, level, badges[], hudTheme, updatedAt}
usernames/{handleLower}           {uid, reservedAt}
users/{uid}/following/{targetUid} {uid: targetUid, at}
```

`*` `profiles.username` is written only by `reserveUsername`; the rules
refuse client writes that touch it. Board entries snapshot `username`/
`photoURL`/`level` from the profile at submit time; `reserveUsername` fans a
rename out to the user's existing entries and challenge cards (best-effort,
≤ 400 docs).

Scores on the boards are the **cue action score** (`CueJudge.score.score`),
not the composed workout score shown on the summary hero (which adds playback
progress). The server can only replay the former.

### Access (firestore.rules)

- `users/**` owner-only (unchanged); `users/{uid}/following/*` owner-write,
  signed-in read, document must be exactly `{uid: targetUid, at}`.
- `profiles/{uid}` signed-in read; owner create/update of presentation fields
  only; no `username`.
- `leaderboards/**`, `dailyLeaderboards/**`, `challenges/**`, `beatmaps/**`,
  `usernames/**` signed-in read, **no client writes**.
- `runNonces`, `submissions`, `rateLimits` no client access.
- `supportMessages` unchanged.

### Indexes (firestore.indexes.json)

- `entries` (collection scope): `classKey ASC, score DESC` — class-filtered
  boards (`fetchTopEntries({classKey})`).
- Field override on `entries.uid` adding a `COLLECTION_GROUP ASC` index so
  `collectionGroup('entries').where('uid','==',…)` works (rename fan-out,
  account deletion). Single-field defaults are re-listed because an override
  replaces them.

The Friends tab uses `where(documentId(), 'in', chunk)` in chunks of 30 and
sorts client-side, so it needs no composite index. Global boards order by
`score` only (automatic index). Ranks use `count()` aggregation over
`score > mine` (1 read per call).

## Submission flow

1. **Run start** (`workout.tsx`): for a level with a beatmap and a timed run
   the client calls `startRun({levelId, beatmapHash})`. The server checks the
   beatmap is published with that hash, applies the 30/day budget, and issues
   a UUID nonce (`runNonces/{nonce}`). Failure is non-fatal — the run still
   records locally, it just cannot be submitted.
2. **During the run** the `CueJudge` keeps a compact log of every judgement
   (`JudgeEvent {i, l, g, d, t}`; ≤ 5000 entries, ~3–6 KB for a 10 min run).
3. **Finish**: `workout.tsx` stages `{nonce, log, spurious, score, maxCombo,
   accuracy, elapsed, target, rate, videoLength}` in a module-level store keyed
   by runId (`runSubmission.ts`) — route params are strings and the log must
   be passed verbatim.
4. **Summary**: after `recordRun` succeeds, `submitRunIfEligible` builds the
   payload (adds `classKey`, `appVersion`, local `dateKey`) and calls
   `submitRun`. The summary shows rank / daily rank, "View board" and "Beat my
   score", or an explanatory line when the run did not post. The local record
   is never affected by the outcome.

Only **timed (looping) runs** are submitted: for them accumulated video time is
`elapsed × rate`, which the verifier needs to rebuild the cue set. Untimed
play-to-end runs report a raw video position and are rejected server-side
(`bad-target`); the client does not stage them. This is a deliberate
simplification of the original design ("targetSeconds|null") — every entry
point today (`level/[id]`, `preflight`) passes a duration.

## Validation rules (`shared/scoring/submission.ts`)

Shape (`parseSubmitRunPayload`), then semantics (`validateSubmission`):

| Check | Reject code |
| --- | --- |
| `levelId` equals the published beatmap's | `level-mismatch` |
| `beatmapHash` equals the server hash (FNV-1a over the canonical JSON) | `hash-mismatch` |
| `playbackRate ∈ {0.85, 1, 1.2}` | `bad-rate` |
| `60 s ≤ elapsed ≤ 3 h` | `bad-elapsed` |
| timed run and `elapsed ∈ [target − 2, target + 5]` | `bad-target` |
| `|videoLengthSec − videoDurationSec| ≤ 1.0 s` | `bad-video-length` |
| ≤ 5000 events | `too-many-events` |
| `t` non-decreasing; every `t ≤ videoEnd + 1 s` | `events-out-of-order`, `event-after-end` |
| spurious events are exactly `{i:-1,l:-1,d:null}` | `bad-event` |
| every `(l,i)` exists on the looped timeline through `videoEnd + lookahead + 1 s` | `unknown-cue` |
| no `(l,i)` judged twice | `duplicate-cue` |
| `d === null` only for a miss whose window closed by `t` | `grade-delta-mismatch`, `expiry-inconsistent` |
| `|d| ≤ 400`, `p ⇒ |d| ≤ 120`, `g ⇒ 120 < |d| ≤ 250` | `grade-delta-mismatch` |
| `d ≈ (t − 0.150 − cue.at) × 1000` within 2 ms | `delta-inconsistent` |
| every cue whose window closed ≥ 1 s before the end was judged | `missing-cues` |
| `spurious` equals the count of `x` events | `spurious-mismatch` |
| replaying the log with the shared combo rules reproduces `score`, `maxCombo`, `accuracy` exactly | `score-mismatch`, `combo-mismatch`, `accuracy-mismatch` |

Before any of that: the level must have a published `beatmaps/{levelId}`
(`no-beatmap`). Then in the Firestore transaction: nonce exists, unused, same uid / level /
hash, `serverNow − issuedAt ≥ elapsed − 5 s` and `≤ 6 h`
(`nonce-unknown`, `nonce-used`, `nonce-mismatch`, `nonce-timing`); `runId` not
already accepted (`duplicate-run`); rate limits (`daily-limit`, `cooldown`).
Rejections return `{accepted:false, reason}` (not an error) so the client can
explain quietly; malformed payloads throw `invalid-argument`.

Tail tolerance: the judge extrapolates the clock up to 0.75 s between ticks
and schedules cues 3 s ahead, so cues up to `videoEnd + 3 s + 1 s` are
*allowed* and only cues with `at < videoEnd − 0.15 − 0.4 − 1.0` are
*required*. That is the "±1 at tail" from the design, made precise.

### Rate limits

- `startRun`: ≤ 30 per uid per UTC day.
- `submitRun`: ≤ 12 accepted per uid per UTC day; the next acceptance must
  come ≥ `previousElapsed − 30 s` after the previous one. Rejected
  submissions do not consume budget. Counters live in `rateLimits/{uid}`.

### Daily board

`dateKey` is the client's local `YYYY-MM-DD`. The server recomputes the
challenge with the same shared function (`dailyChallengeLevelId(dateKey,
pool)` over **published** beatmaps in `CANONICAL_LEVEL_IDS` order — the same
order as `modes` in `gameData.ts`, asserted by `test:daily-key`). The key is
accepted when `serverNow ∈ [midnightUTC − 14 h, midnightUTC + 36 h + 2 h]`,
i.e. the span during which some time zone (UTC−12 … UTC+14) is on that date,
plus submit slack. The design's `[now − 26 h, now + 14 h]` window would have
rejected a legitimate 23:30 run in the Americas, so it was widened — see the
comment in `shared/scoring/daily.ts`. Entries carry
`expiresAt = midnightUTC + 60 h` for TTL.

If no beatmap is published the pool falls back to every level ("practice"
challenge, same as the client) — but no run can be submitted then anyway.

## Usernames

- Onboarding still picks a handle **offline**: format + reserved-word checks
  only (`shared/scoring/username.ts`), stored in local progress.
- On the first authenticated sync, `ProgressContext` calls
  `ensureUsernameReserved(uid, handle)` → `reserveUsername`. If taken it
  retries up to 3× with a numeric suffix and the local handle adopts whatever
  was reserved. The result is cached per uid in AsyncStorage so it runs once.
- Profile → Leaderboards → Username (`edit-username.tsx`) reserves
  synchronously and shows "taken".
- `usernames/{handleLower}` is the registry; the transaction releases the
  user's previous handle. Handles are lowercase `[a-z0-9_]{3,20}`.

## Public profile + friends

`profiles/{uid}` is written from `ProgressContext` (debounced) whenever
level, badges (derived from level), HUD theme or photo change. Follow /
unfollow lives on the public profile screen (`runner/[uid]`), reached from
any board row or from Find friends (prefix search over `usernames`). The
Friends tab shows the following list (≤ 100) plus you.

## Beat-my-score

`ShareScoreSheet` renders the card (cover from `modeCovers.ts`, rank, score,
accuracy, combo, "Can you beat it?", wordmark, short link), rasterizes it with
`react-native-view-shot` and hands the PNG to `expo-sharing`. If the native
module is missing (dev client built before this feature) it falls back to
sharing text + link via RN `Share`.

Links:

- `cardiosurf://level/{id}?challenge={runId}`
- `https://cardiosurf.com/l/{id}?c={runId}` → `src/app/l/[id].tsx` redirects
  to `/level/{id}?challenge={runId}`.

`level/[id]` reads `challenges/{runId}` and shows the banner
("@name scored 1,240 · 91% — beat it") plus a Leaderboard entry point (or
"Needs a beatmap"). `_layout.tsx` stashes a parsed challenge/level link when
the auth gate redirects (welcome / create-account / resume) and replays it
once the gate settles on tabs.

## Residual cheating risk

There is **no App Check** with the Firebase JS SDK in Expo (no native
attestation provider), so a determined attacker with a valid Firebase user
can call the callables directly. What the verifier guarantees is that a
submitted run is *internally consistent with a real run of that chart*: it
must contain a judgement for every cue whose window closed, deltas must
match cue times and grades, the replay must reproduce the totals, and the
nonce must have been issued at least `elapsed − 5 s` earlier. A forger
therefore has to (a) hold a nonce for the full run length, (b) fabricate a
plausible per-cue log, and (c) stay under 12 accepted runs/day — which caps
the damage at "one perfect-looking run per cooldown", not arbitrary scores.
Pose classification itself cannot be verified server-side (no video is
uploaded). Mitigations if abuse appears: `submissions/{runId}` keeps the full
log for forensic review; entries can be deleted by admin; add App Check via
a native attestation module once a native build is in play.

## Owner steps (in order)

1. **Enable APIs** (Blaze already):
   `gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com eventarc.googleapis.com run.googleapis.com`
2. **Deploy**: `firebase deploy --only functions,firestore` (rules + indexes +
   4 functions). Wait for the composite index to become READY.
3. **TTL**: `gcloud firestore fields ttls update expiresAt --collection-group=entries --enable-ttl`
   (or Console → Firestore → TTL).
4. **Publish beatmaps** for every level that ships a JSON in
   `src/data/beatmaps/` and is registered in `beatmapRegistry.ts`:
   `node --import ./scripts/register-src-alias.mjs --experimental-strip-types scripts/publish-beatmap.ts <levelId>`
   (needs `npm --prefix functions install` and ADC). Until at least one is
   published nothing can be submitted and boards stay empty.
5. **Team ID**: `WUW8GPQ5PT` is set in `web/aasa/apple-app-site-association`
   (App Store Connect → Membership).
6. **Hosting**: `firebase deploy --only hosting` (serves the AASA and the
   `/l/*` fallback page). Add `web/og/beat-my-score.png` if you want a real OG
   image (the HTML references it).
7. **Native build** (EAS): `ios.associatedDomains` and `react-native-view-shot`
   both need a new binary. Until then the share card falls back to text and
   universal links open the web fallback page (the custom scheme works).
8. **Budget alert** on the project (Billing → Budgets).

## Owner TODOs / deferred

- Team ID placeholder in the AASA (not readable from this checkout).
- No OG image asset; `web/l/index.html` references `/og/beat-my-score.png`.
- The share card from the summary uses this run's accuracy/combo with the
  user's *best* score; when the run did not improve the best, prefer sharing
  from the leaderboard screen (uses the best entry throughout).
- Follower counts, blocking/reporting, and a moderation path for usernames
  are not built.
- App Check (needs a native attestation provider).

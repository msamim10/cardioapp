# Leaderboards + Beat-my-score

Per-video leaderboards backed by Cloud Functions, a 24 h daily-challenge
board, a minimal follow graph, and shareable "beat my score" cards that deep
link into the level. This replaces the simulated Home leaderboard (cohorts,
`advanceSimulatedCohort`, fabricated runner counts), which is gone.

## Where things live

| Area | Path |
| --- | --- |
| Shared scoring / validation (no deps) | `shared/scoring/*.ts` — `beatmap`, `grading`, `consensus`, `daily`, `levelIds`, `username`, `submission` |
| Cloud Functions | `functions/src/index.ts`, `functions/README.md` |
| Rules / indexes / hosting | `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `web/` |
| Client data layer | `src/lib/leaderboards.ts`, `src/lib/beatmapRegistry.ts` (chart mirror), `src/lib/profileSync.ts`, `src/lib/functionsClient.ts`, `src/lib/runSubmission.ts`, `src/lib/communityActivity.ts` |
| Deep links | `src/lib/challengeLinks.ts`, `src/lib/pendingDeepLink.ts`, `src/app/l/[id].tsx`, `src/app/_layout.tsx` |
| UI | `src/app/leaderboard/[id].tsx`, `src/app/runner/[uid].tsx`, `src/app/find-friends.tsx`, `src/app/edit-username.tsx`, `src/components/DailyChallengeBoard.tsx`, `src/components/LeaderboardRow.tsx`, `src/components/ShareScoreCard.tsx` |
| Admin | `scripts/publish-beatmap.ts` (hand-tuned chart, locks the level), `rebuildConsensusBeatmaps` callable (Profile → "Rebuild charts now", dev screen → "Force rebuild charts") |
| Tests | `npm run test:consensus`, `npm run test:submit-validation`, `npm run test:daily-key` |

The app imports the shared package through the `@shared/*` path alias
(`tsconfig.json`; Metro resolves it via `tsconfigPaths`). `src/lib/beatmaps.ts`,
`src/lib/cueScoring.ts` and `src/lib/username.ts` re-export from it so
existing import paths keep working. Functions import it relatively
(`../../shared/scoring`) and `functions/tsconfig.json` compiles both trees
into `lib/`.

## Data model

```
beatmaps/{levelId}                {version, levelId, videoDurationSec, orientation, cues[], hash,
                                   chartVersion, source: 'consensus'|'manual', runCount, requiredSupport,
                                   confidence[], generatedAt, checkedAt, publishedAt, locked?}
beatmaps/{levelId}/versions/{v}   every published revision, same shape (audit; server-only)
moveSamples/{levelId}/runs/{runId}{uid, at, rate, intensity, videoLengthSec, naturalPlaySec,
                                   samples: [{m, t}]}                       ← server-only
admins/{uid}                      {} presence grants the rebuild callable (owner-readable)
runNonces/{nonce}                 {uid, levelId, beatmapHash, beatmapVersion, issuedAt, used, usedAt?, runId?}
rateLimits/{uid}                  {dayKey, startCount, submitCount, sampleCount, lastAcceptedAt, lastAcceptedElapsed}
submissions/{runId}               full accepted payload + replay totals (audit; server-only)
leaderboards/{levelId}/entries/{uid}
                                  {uid, score, accuracy, maxCombo, at, recorded, runId, username,
                                   photoURL, classKey, level, playbackRate, elapsedSeconds,
                                   provisional, beatmapVersion, beatmapHash}
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
- `leaderboards/**`, `dailyLeaderboards/**`, `challenges/**`, `beatmaps/{levelId}`,
  `usernames/**` signed-in read, **no client writes**.
- `beatmaps/*/versions/**`, `moveSamples/**`, `runNonces`, `submissions`,
  `rateLimits` no client access. `admins/{uid}` owner read only.
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

1. **Run start** (`workout.tsx`): every timed run calls `startRun({levelId})`
   before playback begins. The server applies the 30/day budget, issues a
   UUID nonce (`runNonces/{nonce}`) pinned to the level's **current chart**
   (`beatmapHash` + `beatmapVersion`, or `'none'` / `0` when the level has no
   chart yet) and returns the chart document itself, which the client adopts
   into its mirror and scores against for the whole run. The map does not
   start playing until this settles (≤ 4 s; on timeout or failure the run
   uses the cached chart without a nonce — it still records locally, it just
   cannot be submitted).
2. **During the run** the `CueJudge` keeps a compact log of every judgement
   (`JudgeEvent {i, l, g, d, t}`; ≤ 5000 entries, ~3–6 KB for a 10 min run).
   Independently, **every detected move** during natural playback is recorded
   as a move sample `{m, t}` — `t` = video position at detection minus
   `DETECTION_LATENCY_COMPENSATION_MS`, loop index dropped — capped at 600
   per run. This happens with or without a chart.
3. **Finish**: `workout.tsx` stages `{nonce, beatmapVersion, log, spurious,
   score, maxCombo, accuracy, elapsed, target, rate, intensity, videoLength,
   moveCount, samples, naturalPlaySec}` in a module-level store keyed by
   runId (`runSubmission.ts`) — route params are strings and the log must be
   passed verbatim. Without a chart the log is empty and `score` is the
   free-move action score.
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

Before any of that, in the Firestore transaction: nonce exists, unused, same
uid / level / hash / version, `serverNow − issuedAt ≥ elapsed − 5 s` and
`≤ 6 h` (`nonce-unknown`, `nonce-used`, `nonce-mismatch`, `nonce-timing`);
`runId` not already accepted (`duplicate-run`); rate limits (`daily-limit`,
`cooldown`). The chart the run is verified against is the one the **nonce was
issued for**: the live `beatmaps/{levelId}` when its `chartVersion` still
matches, else the archived `versions/{v}` — so a rebuild landing mid-run never
invalidates the run. Rejections return `{accepted:false, reason}` (not an
error) so the client can explain quietly; malformed payloads throw
`invalid-argument`.

### Provisional runs (no chart yet)

When `startRun` finds no published chart the nonce carries `beatmapHash:
'none'`, `beatmapVersion: 0` and the client scores the run with the 1.0.3
free-move rules. `submitRun` then takes `validateProvisionalSubmission`
instead of the replay:

| Check | Reject code |
| --- | --- |
| nonce was issued with no chart (`hash 'none'`, version 0); a real hash with version 0 or vice-versa | `bad-version` |
| same session checks as above (rate, elapsed, timed target) | `bad-rate`, `bad-elapsed`, `bad-target` |
| no judgement log, `spurious = 0`, `accuracy = 0` | `bad-event` |
| `moveCount ≤ 100 × minutes` | `bad-moves` |
| `maxCombo ≤ moveCount` | `combo-mismatch` |
| `30 × moveCount ≤ score ≤ 100 × moveCount` (what `applyRecognizedMove` can award) | `score-mismatch` |
| samples inside the video and `|samples − min(moveCount, 600)| ≤ 3` | `bad-samples` |

The client's score is accepted as-is and the entry is written with
`provisional: true`, `beatmapVersion: 0`, `accuracy: 0`. The nonce is what
stops a client from *choosing* this path on a charted level: the server, not
the payload, decides whether a run started without a chart. Boards show these
rows with an **EARLY** tag and no accuracy figure; the summary appends
"· Early score". Once the level has a chart every new run is verified
(`provisional: false`); existing provisional rows stay on the board (see
"Chart versions and boards").

### Move samples

Every accepted run (verified or provisional) whose samples pass
`samplesConsistent` and whose `naturalPlaySec ≥ 30` is stored as
`moveSamples/{levelId}/runs/{runId}`, subject to a separate budget of 60
sample reports per uid per UTC day (`rateLimits.sampleCount`). Inconsistent
samples on a verified run are simply dropped (the verdict is unaffected); on
a provisional run they are the evidence and reject it.

Tail tolerance: the judge extrapolates the clock up to 0.75 s between ticks
and schedules cues 3 s ahead, so cues up to `videoEnd + 3 s + 1 s` are
*allowed* and only cues with `at < videoEnd − 0.15 − 0.4 − 1.0` are
*required*. That is the "±1 at tail" from the design, made precise.

### Rate limits

- `startRun`: ≤ 30 per uid per UTC day.
- `submitRun`: ≤ 12 accepted per uid per UTC day; the next acceptance must
  come ≥ `previousElapsed − 30 s` after the previous one. Rejected
  submissions do not consume budget. Counters live in `rateLimits/{uid}`.
- Sample storage: ≤ 60 runs' samples per uid per UTC day (`sampleCount`).

### Daily board

`dateKey` is the client's local `YYYY-MM-DD`. The server recomputes the
challenge with the same shared function (`dailyChallengeLevelId(dateKey,
pool)` over **every** level in `CANONICAL_LEVEL_IDS` order — the same order
as `modes` in `gameData.ts`, asserted by `test:daily-key`; both sides pass
`EVERY_LEVEL_SCORABLE` because charts appear at unpredictable times and must
not move the pick mid-day). The key is
accepted when `serverNow ∈ [midnightUTC − 14 h, midnightUTC + 36 h + 2 h]`,
i.e. the span during which some time zone (UTC−12 … UTC+14) is on that date,
plus submit slack. The design's `[now − 26 h, now + 14 h]` window would have
rejected a legitimate 23:30 run in the Americas, so it was widened — see the
comment in `shared/scoring/daily.ts`. Entries carry
`expiresAt = midnightUTC + 60 h` for TTL.

Every level is scorable (provisionally until its chart exists), so the
"practice" fallback of the pool is never taken; the flag stays on the type for
the replay script only.

## Consensus charts

Charts are not authored; they are **derived from how players actually move**
("the average of how every user performs the exercise at that time") and
refined as more runs arrive. Early charts are rough by design.

### Algorithm (`shared/scoring/consensus.ts`, `buildConsensusBeatmap`)

Input: a level's stored sample runs + the video length. Constants in
`CONSENSUS_DEFAULTS`:

| Step | Detail | Constant |
| --- | --- | --- |
| Histogram | per move type, bucket sample times into 200 ms bins; a run counts **at most once per bin** (a spammer cannot outvote three honest runs) | `binMs = 200` |
| Smooth | kernel `1 2 3 2 1` so a beat on a bin edge yields one peak | — |
| Peaks | local maxima; support = **distinct runs** with that move within ±450 ms of the bin centre | `windowMs = 450` |
| Threshold | keep peaks with support ≥ `max(minRuns, ceil(supportFraction × runs))` | `minRuns = 3`, `supportFraction = 0.35` |
| Cue time | weighted median of the in-window samples, each run's samples sharing a weight of 1 | — |
| Merge / conflicts | candidates (any move) closer than 0.8 s = 2 × `CUE_WINDOW_MS`: higher support wins, tie → earlier, then `BEATMAP_MOVES` order | `minGapS = 0.8` |
| Publish floor | fewer than 4 cues → no chart yet (level stays provisional) | `minCues = 4` |
| Version churn | a rebuild is a new version only if a cue was added/removed, changed move, or moved > 150 ms | `moveToleranceS = 0.15` |

Output: a `Beatmap` in the existing format (times rounded to ms, sorted, so
`beatmapHash` is stable and submissions verify like an authored chart) plus
per-cue `support` / `confidence = support / runCount` and `runCount`.
Deterministic: run order and sample order do not matter (`test:consensus`).

**Tuning.** Rough → strict: raise `minRuns` (3 → 5) once every map has a
dozen runs; raise `supportFraction` (0.35 → 0.5) to drop moves only a third
of players make; lower `windowMs` to tighten timing once reaction jitter is
known. Loosen `minCues` if a short map legitimately has few beats. All are
read at build time, so a redeploy of the functions applies them; the next
scheduled rebuild republishes only levels whose chart actually changed.

### Rebuild (`rebuildConsensusBeatmaps`)

`rebuildConsensusBeatmapsJob` runs **every 30 minutes** (`onSchedule`);
`rebuildConsensusBeatmaps` is the same routine as an admin callable (Profile
→ "Rebuild charts now (admin)" — shown only when `admins/{uid}` exists; the
dev authoring screen has "Force rebuild charts"). Per level: read the latest
≤ 400 sample runs, keep those on the majority video length (the vertical
cut), build; if `runs < minRuns` → `not-enough-runs`; if the builder returns
null → `no-consensus`; if `!materiallyDifferent` → `unchanged` (only
`runCount`/`checkedAt` are touched); else write `beatmaps/{levelId}` with
`chartVersion = n + 1`, `source: 'consensus'`, and archive the same doc at
`versions/{n+1}`. A doc with `locked: true` (hand-tuned chart published by
`scripts/publish-beatmap.ts`) is never overwritten (`locked`). The callable
returns the per-level summary the app shows in an alert.

Admin = `admin` custom claim **or** an `admins/{uid}` document. Create the
owner's doc once (Console → Firestore → `admins` → doc id = the owner's Auth
uid, any field or empty) — see `functions/README.md` for the REST one-liner.

### Client chart mirror (`src/lib/beatmapRegistry.ts`)

The client never ships charts (bundled JSON remains for dev only). It mirrors
`beatmaps/{levelId}` into AsyncStorage with a **6 h TTL**: hydrated at launch,
refreshed in one query per sign-in when any level is stale, refreshed per
level when its detail screen opens, and **adopted from the `startRun` reply**
(authoritative for that run). `hasBeatmap` / `getBeatmap` stay synchronous.
Charts therefore arrive without an app update. Campaign skill gates use
`hasMatureBeatmap` — authored charts, or consensus charts from ≥ 10 runs
(`CHART_MATURE_RUNS`) — so a rough early chart never locks anyone out.

### Chart versions and boards

Entries carry `beatmapVersion` (0 = provisional) and `beatmapHash`. A new
chart version does **not** wipe a board: everything stays ranked together,
older-version and provisional rows included (owner: "we can polish it
later"). Future **season reset** option: when charts have matured, copy
`leaderboards/{levelId}/entries` to `leaderboards/{levelId}/seasons/{n}` and
delete entries with `beatmapVersion < current` (or all of them), in one
admin callable; the client needs no change beyond an optional "Season n"
label. Until then the board footer reads "Scoring gets sharper as more people
play this map."

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

## Ghost runners (launch seeding)

Boards and the Home "runners" counts must never look empty at launch, so the
server seeds every board with plausible **ghost runners** and phases them out
automatically as real players fill in. Nothing in the client knows about
ghosts: they are ordinary entry documents (+ `profiles/{uid}` +
`usernames/{handle}`) written by Functions and tagged `ghost: true`, so the
existing UI renders them, tapping a row opens `runner/[uid]`, and the
`count()`-based runner counts include them.

| Piece | Path |
| --- | --- |
| Generator (pure, deterministic) | `shared/scoring/ghosts.ts` |
| Reconcile (hourly schedule + admin callable) | `functions/src/seed.ts` → `reconcileGhosts`, `reconcileGhostsNow` |
| Test | `npm run test:ghosts` (`scripts/replay-ghosts.ts`) |

**What a ghost is.** `(levelId, n)` — or `(dateKey, n)` for daily boards —
deterministically yields uid `ghost_<levelId>_<n>` / `ghost_d_<dateKey>_<n>`,
a handle from a fixed shuffled pool of ~1,400 real-looking lowercase handles
(`marco_cardio`, `rhea_k`, `hugo72`, `fast_rory`; all pass
`checkUsernameClaim`, none reserved, no two ghosts anywhere share one), a
profile (level 3–18, the real badge ids unlocked at that level, a real
unlocked HUD theme id, no photo) and a run. Scores are not invented numbers:
each run is a synthetic judgement log (hit/miss/spurious, perfect vs good,
clustered misses) replayed through the shared `replayJudgements`, so `score`,
`maxCombo` and `accuracy` are consistent exactly like a verified run.
Accuracy lands in 0.55–0.9; runs are 5-minute (some 10-minute) timed runs at
0.85×/1×/1.2×; `classKey` is a mix of the three classes and null;
`recorded: true`; `at` is spread over the past 1–14 days (daily: 08:00–16:00
UTC of that date so it reads as that calendar date from UTC−8 to UTC+8) and
refreshed once older than 21 days. Chart-dependent fields mirror what
`submitRun` would write for that level: `provisional: false` +
`beatmapVersion`/`beatmapHash` when a chart is published, else
`provisional: true`, `beatmapVersion: 0`, `beatmapHash: 'none'`. Daily entries
also carry `levelId`, `dateKey` and the same `expiresAt` as real ones, so TTL
sweeps them.

**Beatable by design.** For each level the generator simulates 256 five-minute
runs of a "decent" player (85 % of cues hit, 70 % of hits perfect, a few
spurious moves ≈ 72 % accuracy) and takes the 67th percentile as the **cap**.
Ghost #0 is re-rolled until it lands in `[0.985 × cap, cap]`; every other ghost
is below the cap. The test asserts a decent player beats the top ghost in
25–50 % of attempts on every level, i.e. reaches #1 within a few tries. Cue
density comes from the published chart when there is one (`cues / duration`),
otherwise a per-level default of 20–30 cues/min; a new chart (density or hash)
rewrites that level's ghosts.

**Thresholds / phase-out.** `GHOST_TARGET_TOTAL = 24` per level board,
`GHOST_DAILY_TARGET = 10` per daily board (`shared/scoring/ghosts.ts`). Every
hour, per board:

```
realCount = count(entries) − count(entries where ghost == true)
target    = clamp(TARGET − realCount, 0, TARGET)
keep      = the `target` highest-scoring ghosts of the fixed set
```

Existing ghosts not in `keep` are deleted (entry + profile + every
`usernames/*` doc they own), so ghosts leave **from the bottom** as real
players arrive and the board is exactly `TARGET` rows until real players
exceed it. Missing ones are written; ones whose `ghostGen` fingerprint or `at`
is stale are rewritten. Daily boards are reconciled for UTC yesterday (while
UTC−12 is still on it), today and tomorrow (pre-seeded), and ghosts of boards
2–3 days old are swept (profiles + handles too; TTL is only the backstop). Only
documents whose id starts with `ghost_` **and** carry `ghost: true` are ever
written or deleted — real players' documents are never touched. Idempotent;
≤ 400 writes per batch commit; one `reconcileGhosts summary` log line per run
with per-board `total / real / ghosts→target / +added ~refreshed −removed`.

**Handle registry.** Ghost handles are reserved in `usernames/{handle}` as
`{uid: 'ghost_…', reservedAt, ghost: true}`, so a real player who wants that
handle gets "taken" and retries with a suffix, exactly as with another real
user. If a real player already owns a ghost's primary handle the ghost falls
back to `<handle>_<3 digits>`. Reservations are released when the ghost is
removed. Ghosts therefore also appear in Find friends prefix search and can be
followed (the follow is just a doc under the follower's `users/` tree).

**Deploy + first run.**

```sh
gcloud services enable cloudscheduler.googleapis.com --project=cardiosurf-mvp   # once, for onSchedule
firebase deploy --only functions:reconcileGhosts,functions:reconcileGhostsNow
```

The callable is admin-only: an `admin` custom claim, an `admins/{uid}`
document, or the `ADMIN_UIDS` param (comma-separated Auth uids in
`functions/.env`, gitignored, e.g. `ADMIN_UIDS=abc123,def456`; defaults to
empty). Run the first reconcile immediately rather than waiting for the hour:

```ts
// from any signed-in admin session (dev client / Node with a user token):
const run = httpsCallable(getFunctions(), 'reconcileGhostsNow');
await run({ dryRun: true });                       // report only
await run({});                                     // seed everything
await run({ targetTotal: 0, dailyTarget: 0 });     // purge every ghost now
```

or with a raw ID token:

```sh
curl -X POST https://us-central1-cardiosurf-mvp.cloudfunctions.net/reconcileGhostsNow \
  -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json" \
  -d '{"data":{"dryRun":true}}'
```

`firebase functions:log --only reconcileGhosts` shows the hourly summaries.

**Turning it off.** Set `GHOST_TARGET_TOTAL = 0` and `GHOST_DAILY_TARGET = 0`
in `shared/scoring/ghosts.ts`, redeploy the two functions, and run
`reconcileGhostsNow({})` once (or wait an hour): every ghost entry, profile and
handle is deleted. `reconcileGhostsNow({targetTotal: 0, dailyTarget: 0})`
purges immediately without a redeploy, but the hourly job re-seeds unless the
constants are changed too.

**Ethics.** Ghosts exist only to make an empty product feel alive on day one.
They never take anything from a real player: there are no prizes, and the
score cap means a real player takes #1 within a few tries and every real
player pushes one ghost off the board. They are not labelled as bots in the
UI, so the owner must **remove them (set both targets to 0) before any
prize-backed or advertised competition**, and must not cite ghost-inflated
counts as real user numbers. `ghost: true` on every document keeps them
auditable and removable at any time.

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
("@name scored 1,240 · 91% — beat it") plus a Leaderboard entry point (always
open — every level scores, provisionally until it has a chart). `_layout.tsx` stashes a parsed challenge/level link when
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

Status 2026-09-13: steps 1–3 and 5 are done (APIs enabled; functions, rules
and indexes deployed to `cardiosurf-mvp`, composite index READY; TTL on
`entries.expiresAt` ACTIVE). Step 4 is replaced by consensus charts (see
above): boards are live from day one, charts appear once ≥ 3 runs per level
have been played. Step 7 is build 25 (1.1.0).

1. **Enable APIs** (Blaze already):
   `gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com eventarc.googleapis.com run.googleapis.com`
2. **Deploy**: `firebase deploy --only functions,firestore` (rules + indexes +
   4 functions). Wait for the composite index to become READY.
3. **TTL**: `gcloud firestore fields ttls update expiresAt --collection-group=entries --enable-ttl`
   (or Console → Firestore → TTL).
4. **Seed the charts**: play each map ≥ 3 times (or 3 testers × 1 run each)
   as timed runs of ≥ 60 s, then tap Profile → "Rebuild charts now (admin)"
   (requires `admins/{uid}`) or wait ≤ 30 min for the scheduled job. Levels
   with a chart switch from provisional to verified scoring for new runs.
   A hand-tuned chart can still be published with
   `node --import ./scripts/register-src-alias.mjs --experimental-strip-types scripts/publish-beatmap.ts <levelId>`
   (needs ADC); it bumps `chartVersion`, archives the previous revision and
   sets `locked: true` so the consensus job leaves it alone.
5. **Team ID**: `WUW8GPQ5PT` is set in `web/aasa/apple-app-site-association`
   (App Store Connect → Membership).
6. **Hosting**: `cardiosurf.com` is served by **GitHub Pages** (repo
   `cardiosurf/cardiosurf.github.io`, `CNAME` = cardiosurf.com), **not**
   Firebase Hosting (`cardiosurf-mvp.web.app` has no custom domain). The AASA
   and `/l/index.html` are committed there (`.well-known/apple-app-site-association`,
   `l/index.html`; `404.html` forwards `/l/{id}?c=…` to `/l/?lv={id}&c=…` because
   Pages has no rewrites). `web/` in this repo is the source of truth — when
   it changes, copy the files into the Pages repo and push. The `hosting`
   block in `firebase.json` is only useful if the domain is ever moved to
   Firebase. Add `og/beat-my-score.png` to the Pages repo if you want a real
   OG image (the HTML references it).
7. **Native build** (EAS): `ios.associatedDomains` and `react-native-view-shot`
   both need a new binary. Until then the share card falls back to text and
   universal links open the web fallback page (the custom scheme works).
8. **Budget alert** on the project (Billing → Budgets).

## Owner TODOs / deferred

- ~~No OG image asset~~ — `og/beat-my-score.png` (1200×630) is committed in
  the Pages repo.
- On GitHub Pages `/l/{id}` returns HTTP 404 (then client-side forwards), so
  link previews (iMessage/Slack) won't render OG tags for challenge links.
- The share card from the summary uses this run's accuracy/combo with the
  user's *best* score; when the run did not improve the best, prefer sharing
  from the leaderboard screen (uses the best entry throughout).
- Follower counts, blocking/reporting, and a moderation path for usernames
  are not built.
- App Check (needs a native attestation provider).

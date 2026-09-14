# CardioSurf Cloud Functions

Backend for per-video leaderboards and beat-my-score (Cloud Functions for
Firebase, **2nd gen**, Node 22, TypeScript). Project: `cardiosurf-mvp`, region
`us-central1`. Full design in [`docs/LEADERBOARDS.md`](../docs/LEADERBOARDS.md).

| Export            | Kind                       | Purpose                                                        |
| ----------------- | -------------------------- | -------------------------------------------------------------- |
| `startRun`        | callable                   | Issue a single-use nonce pinned to the level's current chart (or none → provisional) and return the chart (≤ 30/day/uid) |
| `submitRun`       | callable                   | Replay + verify a charted run, or plausibility-check a provisional one; write boards; store move samples (≤ 12/day/uid) |
| `rebuildConsensusBeatmapsJob` | `onSchedule` every 30 min | Rebuild every level's consensus chart from stored move samples |
| `rebuildConsensusBeatmaps` | callable (admin)  | Same, on demand (Profile → "Rebuild charts now", dev screen)   |
| `reserveUsername` | callable                   | Claim a unique handle in a transaction, release the old one    |
| `onUserDeleted`   | Auth `onDelete` (1st gen)  | Scrub boards, challenges, username, public profile             |
| `reconcileGhosts` | `onSchedule` hourly        | Seed / phase out ghost runners on every board (`seed.ts`)      |
| `reconcileGhostsNow` | callable (admin)        | Same, on demand: `{dryRun?, targetTotal?, dailyTarget?}`       |

All scoring / validation logic lives in the dependency-free
[`shared/scoring`](../shared/scoring) package and is compiled into `lib/` at
build time (`tsconfig.json` has `rootDir: ".."`, so `lib/functions/src` and
`lib/shared/scoring` are emitted side by side). `firebase.json` runs the build
as a `predeploy` step. Nothing here is deployed automatically — every command
below is for the project owner to run.

## Requirements

- Firebase project on the **Blaze** plan (2nd-gen functions require it;
  `docs/VIDEO_HOSTING.md` says the project already is).
- Firebase CLI ≥ 13: `npm i -g firebase-tools && firebase login`.
- APIs (enable once; `firebase deploy` will prompt for most, or run):

  ```sh
  gcloud config set project cardiosurf-mvp
  gcloud services enable \
    cloudfunctions.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    eventarc.googleapis.com \
    run.googleapis.com \
    firestore.googleapis.com
  ```

- **Budget alert (recommended):** Cloud Console → Billing → Budgets & alerts →
  create a budget for the project (e.g. $10/month with 50/90/100% emails).
  The callables are cheap (a few reads/writes per run) but a bug or abuse
  spike should page you, not surprise you on the invoice.

## Install / typecheck / build

```sh
cd functions
npm install            # node_modules is gitignored; ~60 MB
npm run typecheck      # tsc --noEmit (includes ../shared/scoring)
npm run build          # emits lib/ (gitignored)
```

Disk-constrained machines: `rm -rf functions/node_modules functions/lib` after
verifying; deploy re-installs on the build server.

## Deploy

```sh
# from the repo root
firebase use cardiosurf-mvp
firebase deploy --only functions,firestore        # functions + rules + indexes
# or piecemeal
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions:startRun,functions:submitRun
```

Composite indexes in `firestore.indexes.json` take a few minutes to build; the
Friends tab and class-filtered boards return errors until they are `READY`
(check Firestore → Indexes in the console).

## Firestore TTL (daily boards)

`dailyLeaderboards/{dateKey}/entries/{uid}` carries `expiresAt` (Timestamp,
~48 h after the date's UTC midnight). Enable a TTL policy once so Firestore
deletes them for you:

```sh
gcloud firestore fields ttls update expiresAt \
  --collection-group=entries --enable-ttl --project=cardiosurf-mvp
```

or Console → Firestore → **TTL** → Create policy → collection group `entries`,
field `expiresAt`. Note the policy applies to the `entries` collection group,
which also contains `leaderboards/*/entries` — those documents have **no**
`expiresAt` field, so they are never deleted. TTL deletion is best-effort
(typically within 24 h of expiry).

## Consensus charts (default path)

Charts are derived from players' move samples — algorithm, thresholds and
tuning in `docs/LEADERBOARDS.md` → "Consensus charts". Nothing to publish by
hand: once a level has ≥ 3 stored runs the scheduled job (every 30 min)
writes `beatmaps/{levelId}` and archives each revision under `versions/{v}`.
Until then runs on that level are accepted as **provisional** (client score,
plausibility-checked) so boards are live from day one.

**Admin access** for the on-demand callable: an `admin` custom claim or an
`admins/{uid}` document. Create the owner's doc once (find the uid under
Authentication → Users, or `firebase auth:export /tmp/u.json --project cardiosurf-mvp`):

```sh
# Console: Firestore → Start collection `admins` → document id = <uid> → field `createdAt` (any value)
# or REST with the owner's gcloud credentials:
curl -X PATCH "https://firestore.googleapis.com/v1/projects/cardiosurf-mvp/databases/(default)/documents/admins/<uid>" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
  -d '{"fields":{"createdAt":{"integerValue":"'$(date +%s000)'"}}}'
```

Force a rebuild from the app (Profile → "Rebuild charts now (admin)" appears
once the doc exists) or with a raw ID token:

```sh
curl -X POST https://us-central1-cardiosurf-mvp.cloudfunctions.net/rebuildConsensusBeatmaps \
  -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json" -d '{"data":{}}'
```

The reply lists every level as `not-enough-runs | no-consensus | unchanged |
published | locked | error` with runs / cues / chartVersion.
`firebase functions:log --only rebuildConsensusBeatmapsJob` shows the
half-hourly summaries.

## Publish a hand-tuned beatmap (optional)

A chart authored on the dev screen can replace the consensus one. The script
bumps `chartVersion`, archives the previous revision and sets `locked: true`
so the consensus job leaves the level alone (Application Default Credentials;
never commit a key):

```sh
gcloud auth application-default login
npm --prefix functions install
node --import ./scripts/register-src-alias.mjs --experimental-strip-types \
  scripts/publish-beatmap.ts <levelId>              # publish/refresh
node --import ./scripts/register-src-alias.mjs --experimental-strip-types \
  scripts/publish-beatmap.ts <levelId> --unpublish  # take a level off the boards
```

Clients pick the new chart up from Firestore (6 h cache, refreshed on level
open) — no app release needed. Runs already in progress keep verifying against
the version their nonce was issued for.

## Local emulator

```sh
cd functions && npm run build && cd ..
firebase emulators:start --only functions,firestore,auth
```

Point the app at the emulator in dev by adding, before any callable is used:

```ts
import { connectFunctionsEmulator } from 'firebase/functions';
connectFunctionsEmulator(getFirebaseFunctions(), 'localhost', 5001);
```

(`src/lib/functionsClient.ts` exposes `getFirebaseFunctions()`; this wiring is
intentionally not committed.)

## Hosting (AASA + link fallback)

**`cardiosurf.com` is served by GitHub Pages** (repo
`cardiosurf/cardiosurf.github.io`), not Firebase Hosting. The files below are
deployed by copying `web/aasa/apple-app-site-association` →
`.well-known/apple-app-site-association` and `web/l/index.html` → `l/index.html`
in that repo and pushing. The Firebase Hosting config is kept only in case the
domain moves.

`firebase.json` also configures Hosting from `web/`:

- `/.well-known/apple-app-site-association` → `web/aasa/apple-app-site-association`
  (served as `application/json`). The Apple Team ID is `WUW8GPQ5PT`; it is already set as the
  Team ID (App Store Connect → Membership, or `eas credentials`).
- `/l/**` → `web/l/index.html` — OG tags + "Open in CardioSurf" + App Store
  link, and a JS hop to `cardiosurf://level/{id}?challenge={runId}`.

```sh
firebase deploy --only hosting   # only if cardiosurf.com is ever pointed at Firebase
```

Universal links additionally need `ios.associatedDomains` (already in
`app.json`) compiled into a **new native build** (EAS / Xcode) — it is an
entitlement, not JS.

## Logs

```sh
firebase functions:log --only submitRun
```

Rejections log `submitRun rejected {uid, runId, reason}`; the reason codes are
listed in `docs/LEADERBOARDS.md`. Accepted runs log `{provisional,
samplesStored}` so you can watch the sample pool grow before the first chart
lands.

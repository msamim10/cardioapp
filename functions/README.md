# CardioSurf Cloud Functions

Backend for per-video leaderboards and beat-my-score (Cloud Functions for
Firebase, **2nd gen**, Node 20, TypeScript). Project: `cardiosurf-mvp`, region
`us-central1`. Full design in [`docs/LEADERBOARDS.md`](../docs/LEADERBOARDS.md).

| Export            | Kind                       | Purpose                                                        |
| ----------------- | -------------------------- | -------------------------------------------------------------- |
| `startRun`        | callable                   | Issue a single-use nonce for a cued run (≤ 30/day/uid)         |
| `submitRun`       | callable                   | Replay + verify a finished run; write boards (≤ 12/day/uid)    |
| `reserveUsername` | callable                   | Claim a unique handle in a transaction, release the old one    |
| `onUserDeleted`   | Auth `onDelete` (1st gen)  | Scrub boards, challenges, username, public profile             |

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

## Publish beatmaps

`submitRun` only accepts runs on levels with a published beatmap in
`beatmaps/{levelId}` whose `hash` matches the app's copy. Publish with the
admin script (Application Default Credentials; never commit a key):

```sh
gcloud auth application-default login
npm --prefix functions install
node --import ./scripts/register-src-alias.mjs --experimental-strip-types \
  scripts/publish-beatmap.ts <levelId>              # publish/refresh
node --import ./scripts/register-src-alias.mjs --experimental-strip-types \
  scripts/publish-beatmap.ts <levelId> --unpublish  # take a level off the boards
```

Publish and ship the same JSON in the same release: a changed file changes the
hash and older builds are rejected with `hash-mismatch` until they update.

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

`firebase.json` also configures Hosting from `web/`:

- `/.well-known/apple-app-site-association` → `web/aasa/apple-app-site-association`
  (served as `application/json`). **Replace `TEAMID_TODO`** with the Apple
  Team ID (App Store Connect → Membership, or `eas credentials`).
- `/l/**` → `web/l/index.html` — OG tags + "Open in CardioSurf" + App Store
  link, and a JS hop to `cardiosurf://level/{id}?challenge={runId}`.

```sh
firebase deploy --only hosting
```

Universal links additionally need `ios.associatedDomains` (already in
`app.json`) compiled into a **new native build** (EAS / Xcode) — it is an
entitlement, not JS.

## Logs

```sh
firebase functions:log --only submitRun
```

Rejections log `submitRun rejected {uid, runId, reason}`; the reason codes are
listed in `docs/LEADERBOARDS.md`.

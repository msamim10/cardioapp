# Cardiosurf — Engineer Handoff

A working notebook for the next engineer picking this project up cold. The
goal here is to get you productive in about an hour: what the app is, where
the moving parts live, the non-obvious gotchas we've already paid the price
for, and where to put new things.

Treat the in-repo `README.md` as outdated marketing copy — it predates the
GLB pipeline, the train roof-run, the airplane / cloud layer, the coin
trail, and the loading overlay. **This document is the source of truth for
how the runtime actually works today.** Source code is the second source
of truth. The other top-level docs (`AGENTS.md`, `assets/models/README.md`)
are also stale — read them only with that caveat.

---

## 1. The idea

Cardiosurf is an **Expo / React Native iOS workout app shaped like a
Subway Surfers-style endless runner.** The phone sits on a desk or is
propped up while the user does stationary cardio in front of it.

The twist: **the player never taps to play.** There are no touch controls
during a run, no body tracking, no swipes. The 3D camera drives itself
through a procedurally recycled world — `AutoCamera.tsx` watches the
upcoming chunks every frame and reacts to obstacles by sliding between
lanes, jumping over barriers, ducking under signs, and (during the
roof-run sections) leaping between train cars. The "workout" framing is
the visual + motivational layer on top of a fully hands-free aerobic
session.

Why we built it as a game rather than a plain workout timer:

- **Coin collection + score-go-up + cue badges** keep the user mentally
  engaged so they don't bail out of the workout at minute three.
- The cue badge (`JUMP` / `DUCK` / `LEFT` / `RIGHT` / `JUMP LEFT` /
  `JUMP RIGHT`) signals to the user when they should physically jump,
  squat, or shift their weight — turning the on-screen avatar's actions
  into a stationary cardio prompt.
- The calorie estimate (`estimateCalories` in `src/lib/calories.ts`) and
  the session log on the home screen give the user the "I worked out
  today" payoff at the end.

The home screen, summary screen, and settings screen are the workout-app
shell. The workout screen (`src/app/workout.tsx`) is the entire game.

---

## 2. Tech stack

Read `package.json` for exact versions; the headlines today:

- **Expo SDK 54** (`expo ~54.0.0`) on top of **React Native 0.81.5** and
  **React 19.1.0**.
- **Expo Router** (`expo-router ~6.0.23`) for screens. Typed routes are
  on (`app.json` -> `experiments.typedRoutes: true`).
- **React Three Fiber** (`@react-three/fiber ^9.6.1`) — we use the
  `/native` entry point everywhere (`import { Canvas, useFrame, useThree }
  from '@react-three/fiber/native'`).
- **three.js** (`three ^0.166.1`) for the underlying graphics.
- **expo-three** (`expo-three ^8.0.0`) — used for its `TextureLoader`
  (`expo-three/build/TextureLoader`), which is what loads our external
  PNG textures into three.js. We do **not** use any of expo-three's
  Renderer helpers; the R3F `<Canvas>` does that for us.
- **expo-gl** (`~16.0.10`) is the WebGL implementation underneath R3F.
- **GLTFLoader** from `three/examples/jsm/loaders/GLTFLoader.js` for
  loading `.glb` files.
- **expo-audio** (`~1.1.1`) for the coin SFX. We use `useAudioPlayer`
  with three rotating instances (see `coinSoundA/B/C` in `workout.tsx`)
  so back-to-back coin pickups don't cut each other off.
- **expo-keep-awake** (`~15.0.8`) — `useKeepAwake()` at the top of the
  workout screen prevents the device from sleeping mid-workout.
- **@react-native-async-storage/async-storage** (`2.2.0`) for the
  session log and the user weight profile.
- **TypeScript** everywhere, strict mode. There is **no Babel-only
  source code** in this project. React Compiler is on
  (`app.json` -> `experiments.reactCompiler: true`) so don't add
  hand-rolled memoization unless the compiler is provably failing on a
  hot path.

Path aliases: `@/*` -> `./src/*` and `@/assets/*` -> `./assets/*`
(`tsconfig.json`). Use the alias style, every existing file does.

Metro is configured (`metro.config.js`) to bundle `.glb` and `.gltf` as
static assets so `require('../../assets/models/foo.glb')` returns an
asset module number that `expo-asset` understands.

---

## 3. Project layout

```
cardiosurf/
├── app.json                Expo config (name=cardiosurf, ios.icon=expo.icon, plugins)
├── metro.config.js         Adds .glb / .gltf to resolver.assetExts
├── tsconfig.json           extends expo/tsconfig.base, strict, @/* path alias
├── package.json            Expo SDK 54, RN 0.81, R3F 9, three 0.166
├── README.md               STALE (says SDK 56, "primitives by default"). Do not trust.
├── AGENTS.md               One stale line. Ignore.
├── assets/
│   ├── models/             ~30 GLBs + 4 extracted PNG textures + stale README
│   ├── sounds/             coin.mp3 (used), coin.wav (unused)
│   └── images/             App icons + splash. Nothing referenced by the scene.
└── src/
    ├── app/                Expo Router screens
    ├── components/
    │   ├── hud/            React Native overlay UI
    │   └── scene/          R3F / three.js scene graph
    ├── hooks/              useWorkoutTimer, useUserWeight
    └── lib/                types, constants, storage, calorie math, model registry, roof-run math
```

### `src/app/` — Expo Router screens

- `_layout.tsx` — root `<Stack>`. Sets `headerShown: false`, dark
  `contentStyle`, `'fade'` animation. The `workout` screen has gestures
  disabled so a back-swipe doesn't kill your run.
- `index.tsx` — home screen: "READY TO RUN?" hero, three stat cards
  (Sessions / Total time / Calories), big `START WORKOUT` button, list
  of the 5 most recent sessions. Pulls sessions from
  `loadSessions()` / `summarizeSessions()` in `src/lib/storage.ts`.
- `workout.tsx` — the entire game. Hosts `<SubwayScene>`,
  `<WorkoutHud>`, the loading overlay, the GLB preloader, the coin
  sound bank, the score ticker, the workout timer, and the cue
  pass-through from AutoCamera. **This is the file to read first if
  you want to understand session lifecycle.**
- `summary.tsx` — "WORKOUT COMPLETE" screen with duration + calorie
  metrics and Save/Discard buttons. Reads `durationSec` and
  `calories` from the router params populated by `handleEnd` in
  `workout.tsx`.
- `settings.tsx` — Weight stepper (kg/lb toggle, MIN_KG=30, MAX_KG=200),
  a card explaining the MET formula, and a "Clear all sessions"
  destructive button.

### `src/components/scene/` — the 3D world

The interesting half of the codebase. Major components:

- **`SubwayScene.tsx`** — root R3F `<Canvas>`. Sets up sky color,
  fog, the initial camera (`fov: 70`, eye height
  `CAMERA_EYE_HEIGHT = 1.55`), and composes the scene tree:
  Lighting → CartoonClouds → AirplaneFlyby → Track → ObstaclesField →
  TrainRoofRun → Coins → ForwardRunner → AutoCamera. Toggles
  `frameloop` between `'always'` and `'demand'` based on `paused`.
- **`AutoCamera.tsx`** — the autopilot. Owns lane state, jump arc,
  duck dip, the combined leap, and publishes the current `ActionCue`
  to the HUD via `onCueChange`. Detailed in §4.
- **`Track.tsx`** — thin wrapper that renders one `<EnvironmentChunk>`
  per chunk. Uses a `visual-chunk-${index}` key so chunks stay
  mounted across recycling (see §7 — "Don't re-mount GLB scenery").
- **`EnvironmentChunk.tsx`** — one 24m segment of dirt ground +
  wooden ties + 6 silver rails + side fences + skyline buildings (5
  per side, deterministic from `seed`) + procedural street props +
  optional GLB city props (traffic lights, billboards, benches,
  hydrants, etc.). All randomness comes from a chunk-local
  `mulberry32(seed)`. Wrapped in `React.memo` so a new chunk array
  with the same `startZ` per slot doesn't re-render.
- **`ObstaclesField.tsx`** — flat-maps every `chunk.obstacles[]` into
  `<Obstacle>` children.
- **`Obstacle.tsx`** — renderer for the four `ObstacleKind` values:
  `barrier`, `overhead`, `wall`, `trainGap`. Uses the
  `trafficBarrier.glb` + extracted `trafficBarrier.png`,
  `overheadObstacle.glb` + `overheadObstacle.png`, and `train.glb`
  models with procedural fallbacks (`BarrierProp`, `CrossingArm`,
  `TrainPrimitive` — the train primitive alone is ~50 RoundedBoxes /
  meshes). `trainGap` renders `null` — it's a logic-only obstacle.
- **`Coins.tsx`** — per-chunk coin trails. Deterministic layout from
  `chunk.seed`. Shared geometry + `MeshBasicMaterial` across all
  coin instances. Collection is "did the camera cross this z while
  in this lane?" — see `COIN_COLLECT_Z_WINDOW = 0.55` and
  `COIN_COLLECT_LANE_WINDOW = 0.7`. Roof-run chunks lay coins on top
  of the trains via `computeRoofRunChunkCoins`.
- **`CartoonClouds.tsx`** — 14 hand-placed cloud clusters + 4 bird
  flocks. Root `<group>` is `useFrame`-locked to the camera position
  every frame (skybox-style).
- **`AirplaneFlyby.tsx`** — one procedural plane on a 32-second
  left-to-right loop high in the sky, contrail puffs, gentle pitch.
  Same skybox lock pattern as the clouds.
- **`TrainRoofRun.tsx`** — for any chunk whose `roofRun` field is
  set, places 3 `train.glb` instances along the chunk plus an entry
  or exit `<Ladder>` if applicable.
- **`Ladder.tsx`** — fully procedural ladder (two yellow rails +
  six brown rungs). The bridge GLB and the original ladder GLB both
  failed reliability checks on native, so this is built from boxes.
- **`ForwardRunner.tsx`** — headless component. Each frame: caps
  `dt` at 0.05s, advances `camera.position.z` by
  `-CAMERA_FORWARD_SPEED * dt`, and asks `recycleFarthestBehind` if
  a chunk needs recycling. Chunk state updates are deferred via
  `requestAnimationFrame` + `React.startTransition` to keep the
  recycle off the hot frame.
- **`Lighting.tsx`** — bright ambient + warm directional sun + cool
  fill directional + hemisphere bounce. No shadow casting.
- **`chunkManager.ts`** — `createInitialChunks()`,
  `recycleFarthestBehind()`, and the integer `chunkIdCounter` /
  `seedCounter` helpers. Recycle has subtle special-cases for
  roof-run chunks — covered in §4.
- **`obstacleSpawner.ts`** — `spawnObstaclesForChunk(startZ, seed)`.
  Uses 4 slots per 24m chunk, weighted picks
  (`barrier 0.5 / overhead 0.3 / wall 0.2`), and a hard invariant
  that no slot ever blocks all 3 lanes.
- **`buildings.tsx`** — 7 building variants (`<Building>` renders
  the one selected by `spec.variant`). Reads palette from
  `ARCADE_PALETTE.buildings`. Some variants pull GLB models
  (`buildingA..buildingI`); others are full procedural.
- **`StreetProps.tsx`** — hydrant / trashcan / bench / vendor /
  stopsign / newsbox primitives mounted on the sidewalk strip.
- **`Graffiti.tsx`** — painted tags on building faces and barriers.
- **`RoundedBox.tsx`** — shared rounded-cube primitive used in
  dozens of places (train body, barrier, sidewalk fence, etc.).
- **`models/GLBModel.tsx`** — the GLB loader wrapper. Detailed in §5.

### `src/components/hud/` — React Native overlay

- **`WorkoutHud.tsx`** — the only HUD that's actually used. Owns the
  score number, coin counter, pause button (top-left), the cue badge
  pill (center-top), and the END button (bottom, only visible when
  paused). The `CUE_CONTENT` record (lines ~74-83) is the
  `ActionCue` → label string mapping.
- **`CountdownOverlay.tsx`** — 3-2-1-GO overlay. **Currently not
  imported anywhere** (the loading overlay in `workout.tsx`
  replaced it). Kept around in case we want to re-introduce a
  countdown after preloading.

### `src/lib/`

- **`types.ts`** — `Lane`, `ObstacleKind`, `ActionCue`, `RoofRunRole`,
  `RoofRunVariant`, `ObstacleSpec`, `ChunkSpec`, `Session`,
  `UserProfile`. Every new game-data type goes here.
- **`constants.ts`** — lane geometry (`LANE_X`, `TRACK_WIDTH = 5.2`),
  chunk geometry (`CHUNK_LENGTH = 24`, `CHUNKS_AHEAD = 5`,
  `CHUNKS_BEHIND = 1`), camera dynamics (`CAMERA_FORWARD_SPEED = 11`,
  `CAMERA_EYE_HEIGHT = 1.55`, `CAMERA_DUCK_HEIGHT = 0.85`,
  `CAMERA_JUMP_PEAK = 2.6`), action timings (`LANE_CHANGE_DURATION =
  0.32s`, `JUMP_DURATION = 0.7s`, `DUCK_DURATION = 0.55s`),
  AutoCamera trigger window (`LOOK_AHEAD_DISTANCE = 18`,
  `REACT_DISTANCE = 9`), fog/sky colors, the
  `ARCADE_PALETTE`, `DEFAULT_MET = 7.0`, `DEFAULT_WEIGHT_KG = 70`,
  and the AsyncStorage keys.
- **`roofRun.ts`** — every train-roof number lives here:
  `TRAIN_LENGTH`, `TRAIN_WIDTH`, `TRAIN_HEIGHT`,
  `TRAIN_ROOF_BASE_Y`, `TRAIN_ROOF_CAMERA_Y`,
  `ROOF_TRAIN_OFFSETS`, ladder lean math, climb/descent envelopes
  (`ENTRY_CLIMB_NEAR_OFFSET = -1.5`,
  `ENTRY_CLIMB_FAR_OFFSET = -4.5`,
  `EXIT_DESCENT_NEAR_OFFSET = -19.0`,
  `EXIT_DESCENT_FAR_OFFSET = -22.0`), section cadence
  (`ROOF_RUN_PERIOD = 14`, `ROOF_RUN_START_OFFSET = 7`,
  `ROOF_RUN_SECTION_LENGTH = 7`), and the per-run-chunk lane pattern
  for the `'lane'` variant (`LANE_VARIANT_RUN_LANES = [1, 0, -1, 0, 1]`).
  Also exports `roofRunForStartZ`, `trainGapObstacleSpec`,
  `cameraBaseY`, `forcedLaneFor`, and `upcomingRoofLane`.
- **`modelRegistry.ts`** — the single map of `ModelKey` →
  `require('../../assets/models/foo.glb')`. Detailed in §5.
- **`calories.ts`** — `caloriesPerMinute(weightKg, met)`,
  `estimateCalories(weightKg, durationSec, met)`,
  `formatDuration(s)` (mm:ss), `formatLongDuration(s)`
  ("1h 12m" / "12m").
- **`theme.ts`** — color palette + spacing scale + radii used by the
  React Native UI. Game scene colors are in `ARCADE_PALETTE` in
  `constants.ts`, not here.
- **`storage.ts`** — `loadSessions / saveSession / clearSessions /
  loadProfile / saveProfile / summarizeSessions`. Keys
  `@cardiosurf/sessions` and `@cardiosurf/profile`. Sessions are
  capped at 200 (FIFO).

### `src/hooks/`

- **`useWorkoutTimer.ts`** — wall-clock elapsed time with pause/resume.
  Returns `{ elapsedSec, getElapsedSec }`. Ticks once a second so the
  HUD doesn't re-render every frame; `getElapsedSec()` gives you the
  live up-to-the-millisecond value for the final snapshot.
- **`useUserWeight.ts`** — loads `weightKg` from `loadProfile()` with
  `DEFAULT_WEIGHT_KG = 70` while loading. Exposes a `refresh()`
  callback.

### `assets/`

- **`models/`** (~30 `.glb` files): `train.glb`, `trainCargoContainer.glb`,
  `buildingA..buildingI.glb`, `trafficLight.glb`, `billboard.glb`,
  `trafficBarrier.glb`, `overheadObstacle.glb`, `busStop.glb`,
  `busStopSign.glb`, `stopSign.glb`, `fireHydrant.glb`,
  `fireExit.glb`, `washingLine.glb`, `trashCan.glb`, `bench.glb`,
  `tree.glb`, `mailbox.glb`, `dumpster.glb`, `cone.glb`,
  `fenceEnd.glb`, `ladder.glb` (the procedural Ladder replaced this),
  `bridge.glb` (unused after procedural replacement),
  `cloudBackdrop.glb` (unused), `mountaintop.glb` (unused),
  `maleOfficer.glb` (unused, the cop-chase chase was abandoned).
- **`models/*.png`** (4 files): `trafficBarrier.png`,
  `overheadObstacle.png`, `trafficLight.png`, `maleOfficer.png` —
  textures extracted out of their corresponding GLBs because the
  embedded base64 textures failed on native. See §5.
- **`sounds/coin.mp3`** — the only audio asset that's actually
  played. `coin.wav` exists but nothing references it.
- **`images/`** — app icons and splash. Nothing here is referenced by
  the 3D scene.

---

## 4. Gameplay systems

### Chunk world

Files: `src/components/scene/chunkManager.ts`,
`src/components/scene/EnvironmentChunk.tsx`,
`src/components/scene/Track.tsx`,
`src/lib/constants.ts`.

The world is a ring of `CHUNKS_AHEAD = 5` chunks in front of the
camera and `CHUNKS_BEHIND = 1` behind, each `CHUNK_LENGTH = 24` meters
long. The first chunk's near edge starts a little ahead of the camera
(`z = 4`) so we don't spawn inside geometry.

Recycling lives in `recycleFarthestBehind()` in `chunkManager.ts`:
every frame `ForwardRunner` calls it, and when the camera has moved
far enough that the most-behind chunk is past
`cameraZ + buffer` (buffer = `CHUNK_LENGTH * CHUNKS_BEHIND`), that
chunk is moved to the new far end and gets a fresh `seed` from the
LCG `nextSeed()`. The `id` is bumped too, which is what lets
`<EnvironmentChunk>`'s `React.memo` know it's a new chunk and
re-render its decor.

**Per-chunk determinism.** Each chunk has a `seed: number` set when
it's created or recycled. Both `obstacleSpawner` and the
`EnvironmentChunk` decor `useMemo` derive a `mulberry32(seed)` PRNG
and pull every random choice from it (building variants, prop
positions, sticker colors, the coin lane, etc.). This means a chunk
with the same seed will always look identical — useful for
debugging, and it guarantees the visual world is stable across
re-renders.

**Recycle into roof-run.** `recycleFarthestBehind` calls
`buildRoofRunForChunk(newStartZ, seed)` (which delegates to
`roofRunForStartZ` in `lib/roofRun.ts`) to decide whether the new
chunk should be a roof-run chunk. Three cases on recycle:

1. The chunk becomes a roof-run chunk → use the roof-run obstacle
   template (a single `trainGap` for `'gap'` `'run'`, none otherwise)
   and set the `roofRun` marker.
2. The previous chunk WAS a roof-run chunk, or had no obstacles →
   call the normal `spawnObstacles(newStartZ, seed)`.
3. Else (normal → normal) → reuse the previous obstacles, just shift
   each one's `z` by the chunk delta. This avoids regenerating
   random layouts that already worked, but **don't** copy a
   `trainGap` into a normal chunk — that's why case 2 exists.

### Obstacle spawner

Files: `src/components/scene/obstacleSpawner.ts`,
`src/components/scene/Obstacle.tsx`,
`src/lib/types.ts`.

Each chunk has up to 4 obstacle slots. Per slot the spawner rolls 0
/ 1 / 2 obstacles (`25% / 55% / 20%` weights). The hard invariant:
**no slot ever blocks all 3 lanes.** If a slot has 2 obstacles, they
go in the edge lanes (-1 and 1), leaving the center always passable.

`ObstacleKind` values:

- **`barrier`** — knee-high concrete jersey thing. AutoCamera jumps
  it (or shifts lane if it can). Renderer uses `trafficBarrier.glb`
  with the external `trafficBarrier.png` texture; falls back to
  `BarrierProp` if the GLB / texture fail.
- **`overhead`** — crossing-arm bar across all 3 lanes. AutoCamera
  ducks under it. Renderer uses `overheadObstacle.glb` with the
  external `overheadObstacle.png` texture; falls back to
  `CrossingArm`.
- **`wall`** — full train car blocking one lane. AutoCamera never
  jumps over a train; it forces a lane change into a lane the
  spawner has guaranteed is free at that z. Renderer uses
  `train.glb` (with `fitWidth: 4.4`, scale ~`[1.08, 1.34, 1.08]`,
  rotation `[0, π/2, 0]`); falls back to the elaborate
  `TrainPrimitive` (~50 child meshes).
- **`trainGap`** — non-rendering logic obstacle. Spawned only inside
  `'run'` chunks of the `'gap'` variant of the roof-run section
  (see below). It triggers a jump but nothing draws because the
  trains are owned by `<TrainRoofRun>`.

`AutoCamera` reads `obstacle.kind` and chooses its reaction.

### AutoCamera

File: `src/components/scene/AutoCamera.tsx`.

Owns a single `CameraState` ref:

- `currentLane`, `targetLane` (`Lane` = `-1 | 0 | 1`)
- `laneSwitching` + `laneStartTime` + `laneFromX` + `laneToX`
- `jumping` + `jumpStartTime`
- `ducking` + `duckStartTime`
- `elapsed` — local clock for action timings
- `comboLeapDirection` — set when a forced lane change fires
  simultaneously with a jump (roof-run `'lane'` variant), used to
  keep the HUD cue at `jump-left` / `jump-right` for the full jump
  arc instead of falling back to `jump` once the (shorter) lane
  change finishes.

Each frame `useFrame`:

1. Caps `dt` at 0.05s.
2. Computes the dynamic floor `baseY = cameraBaseY(chunks, cameraZ)`
   — 0 in normal chunks, train roof height during roof-run chunks
   with smooth climb/descent ramps. `eyeY = baseY + CAMERA_EYE_HEIGHT`.
3. **Forced lane lock**: while inside or approaching a roof-run
   chunk, `forcedLaneFor(chunks, cameraZ)` returns the lane the
   player must be in. If different from `targetLane`, start a lane
   switch; if already on the roof (`baseY > 0.5`), also fire a jump
   in the same frame and tag `comboLeapDirection`.
4. **Idle reaction**: if not currently switching/jumping/ducking,
   call `distanceToNextObstacleInLane(chunks, targetLane, cameraZ)`
   and react if it's within `REACT_DISTANCE = 9`:
   - `barrier` → jump if close enough (`dist < JUMP_TRIGGER`), else
     try a lane change first; fall back to jump.
   - `overhead` → duck if close, else try a lane change.
   - `trainGap` → always jump (lane is locked).
   - `wall` (train) → never jump, always force a lane change into a
     lane that the spawner has guaranteed is open at that z.
5. **Apply** the in-flight lane switch (`easeInOutCubic` between
   `laneFromX` and `laneToX`), jump arc (`jumpOffsetY` = parabola
   peaking at `CAMERA_JUMP_PEAK - CAMERA_EYE_HEIGHT`), and duck dip
   (`duckOffsetY` = sinusoidal dip to `CAMERA_DUCK_HEIGHT`).
6. **Publish cue** via `updateCue(currentCue(s) ??
   previewCue(s, chunks, cameraZ, baseY), ...)`. `currentCue` is the
   action that's actually happening; `previewCue` is the pre-cue
   shown when an obstacle is in look-ahead range but the camera
   hasn't reacted yet. Cue trigger constants:
   - `JUMP_TRIGGER = (CAMERA_FORWARD_SPEED * JUMP_DURATION) / 2 + 0.5`
   - `DUCK_TRIGGER = (CAMERA_FORWARD_SPEED * DUCK_DURATION) / 2 + 0.5`
   - `LANE_TRIGGER = CAMERA_FORWARD_SPEED * LANE_CHANGE_DURATION + 1.5`
   - `CUE_PREP_DISTANCE = REACT_DISTANCE`

The cue is published only on change (`updateCue` short-circuits if
`cue === lastCueRef.current`).

### HUD cues

File: `src/components/hud/WorkoutHud.tsx`.

The cue badge is a pill rendered at `top: '23%'` with a yellow border
and a black-on-white text label. Cue values come from
`AutoCamera`'s `onCueChange`; mapping to display strings is the
`CUE_CONTENT` record at the bottom of `WorkoutHud.tsx`:

```ts
const CUE_CONTENT: Record<Exclude<ActionCue, null>, string> = {
  jump: 'JUMP',
  duck: 'DUCK',
  left: 'LEFT',
  right: 'RIGHT',
  'jump-left': 'JUMP\nLEFT',
  'jump-right': 'JUMP\nRIGHT',
};
```

Top-left: pause / resume button. Top-right: score + coin counter
chip (`score.toLocaleString()` over a coin icon + count). Bottom:
the `END` button, **only rendered while paused** — so the user has
to pause first, which makes accidental session-ends nearly
impossible. The end button calls `handleEnd()` in `workout.tsx`,
which navigates to `/summary` with the final duration and calories.

### Coins

File: `src/components/scene/Coins.tsx`.

Per-chunk coin trails generated by `computeChunkCoins(chunk)`:

- Normal chunks: 30% chance of no coins; otherwise pick a lane
  (50% center / 25% each side), lay 6-9 coins spaced across the
  chunk with a gentle sinusoidal arc.
- Roof-run chunks: lay 6 or 8 coins on top of the trains via
  `computeRoofRunChunkCoins`. In the `'gap'` variant we skip the
  last train's coins on `entry` and `run` chunks so the player can
  see the upcoming jump gap; the `'exit'` chunk and the `'lane'`
  variant keep the full trail.

Coin geometry and materials are allocated once and shared across
every coin (`ringGeom`, `ringMat`, `innerGeom`, `innerMat`). The
material is unlit (`MeshBasicMaterial`), because Lambert shading
caused the disc face to dip toward grey each rotation when it faced
away from the lights.

Collection: every frame, `Coins.tsx` checks each visible coin and
emits `onCollect(coin.key)` if either (a) the camera just crossed
the coin's z this frame (`previousZ >= coin.z && currentZ <= coin.z`)
or (b) the camera is within `COIN_COLLECT_Z_WINDOW = 0.55` and the
camera's x is within `COIN_COLLECT_LANE_WINDOW = 0.7` of the coin's
lane. The collected set is owned by `workout.tsx`
(`collectedCoinIds`) and passed back in as `collectedIds` so the
list of visible coins shrinks immediately on pickup. Each pickup
plays one of three rotating `useAudioPlayer` instances so back-to-back
coins don't audibly cut each other off.

### Train roof-run

Files: `src/lib/roofRun.ts`,
`src/components/scene/TrainRoofRun.tsx`,
`src/components/scene/Ladder.tsx`,
`src/components/scene/chunkManager.ts` (the `buildRoofRunForChunk`
helper),
`src/components/scene/AutoCamera.tsx` (the `forcedLaneFor` /
`comboLeapDirection` code paths),
`src/components/scene/Coins.tsx` (the `computeRoofRunChunkCoins`
branch).

A periodic Subway-Surfers-style special section. Cadence:

- Every `ROOF_RUN_PERIOD = 14` chunks.
- First section starts at chunk index `ROOF_RUN_START_OFFSET = 7`.
- Each section is `ROOF_RUN_SECTION_LENGTH = 7` consecutive chunks:
  1 `entry` + 5 `run` + 1 `exit`.
- Section variant alternates per cycle: 1st section is `'gap'`,
  2nd is `'lane'`, 3rd is `'gap'`, ...

`ChunkSpec.roofRun` is the union
`{ role: 'entry' | 'run' | 'exit', variant: 'gap' | 'lane', lane: Lane }`:

- **`role`** controls which trains and which ladder render. `entry`
  draws 3 trains and the entry ladder leaning against the first
  train's near edge; `run` draws 3 trains; `exit` draws 3 trains
  attached to the chunk's near edge so the exit's first train
  butts against the previous run's last train (no gap), plus the
  descent ladder at the back where it leans onto the last train.
- **`variant`** is constant within a section. `'gap'` lays a
  single non-visible `trainGap` obstacle at chunk-local z
  `TRAIN_GAP_OBSTACLE_OFFSET = -2.325`, which `AutoCamera` reacts
  to with a forward jump. `'lane'` lays no obstacle at all; the
  jump-and-leap is driven entirely by the forced lane change.
- **`lane`** is `0` for entry and exit always. For `'gap'` runs,
  every chunk's lane is `0` so the player runs straight. For
  `'lane'` runs, the lanes follow `LANE_VARIANT_RUN_LANES =
  [1, 0, -1, 0, 1]` (one lane shift between every two adjacent
  chunks), and `AutoCamera` fires a combined jump + lane change at
  every chunk boundary because `baseY > 0.5` (the camera is up on
  the train roofs).

Camera Y is interpolated by `cameraBaseY()` over the climb / descent
windows so the POV smoothly rises onto the trains during `entry`
(local z range `-1.5` → `-4.5`) and smoothly drops back during
`exit` (local z range `-19.0` → `-22.0`). The numbers were tuned so
the ramp lines up with the ladder visual.

### Sky layer

Files: `src/components/scene/CartoonClouds.tsx`,
`src/components/scene/AirplaneFlyby.tsx`.

Both components wrap their content in a root `<group>` that, every
frame, is moved to match the camera's exact position:

```tsx
root.position.x = camera.position.x;
root.position.y = camera.position.y;
root.position.z = camera.position.z;
```

This is the skybox trick. Because the cloud/plane positions are
expressed in *world* coordinates inside that locked group, they
never appear to translate relative to the camera no matter how far
the player runs or how often they lane-change / jump / duck. The
clouds also use `MeshBasicMaterial` with `depthWrite: false` so
they layer correctly with each other.

The airplane additionally disables fog on all its materials
(`fog={false}`) so it stays crisp against the sky regardless of
distance.

### Score / coins / time

File: `src/app/workout.tsx`.

- **Score**: a `setInterval(..., 35)` in `workout.tsx` increments
  `score` while `!scenePaused`. 35ms per tick = ~28.5 ticks/sec —
  intentionally fast so the score-go-up feels Subway Surfers-y.
- **Coins**: `collectedCoinIds.size` displayed directly in the HUD.
  Set state lives in `workout.tsx`; deduped via `collectedCoinIdsRef`
  so a coin can't be double-collected during the same render.
- **Time**: `useWorkoutTimer({ paused: scenePaused, active: true })`.
  The HUD doesn't display a clock, but the timer feeds the calorie
  estimate (`estimateCalories(weightKg, elapsedSec)`) and the
  summary screen.

`scenePaused = paused || isLoading` — anytime the loading overlay
is up, all three of (scene, score ticker, workout timer) are
paused. The user never loses workout time to "Getting Ready".

### Loading overlay

File: `src/app/workout.tsx`.

While `isReady === false`:

1. The full-screen `"GETTING READY"` overlay (dark background,
   spinner, "Warming up the run…") is on top of everything.
2. `scenePaused` is true, so `<SubwayScene>`'s `frameloop` is
   `'demand'` (no render budget burned), `ForwardRunner` and
   `AutoCamera` are gated off, and `useWorkoutTimer` doesn't start.
3. The score ticker `setInterval` is also gated by `scenePaused`.

The transition to `isReady = true` happens after
`Promise.all(getAllModelAssets().map(preloadModel))` resolves AND a
hard `setTimeout(..., 400)` cushion. The cushion exists because
preload-resolved is not the same as "GPU has built every material
for every model" — without it, the first 1-2 frames after
isReady=true hitch as the GPU compiles the first batch of shaders.

If any preload rejects, we still flip `isReady` to true so a single
broken GLB can't strand the user on the loading screen.

---

## 5. The GLB pipeline (important — has gotchas)

This is the part of the codebase that bit us the hardest. Read this
section before changing anything that uses `GLBModel`.

### `src/lib/modelRegistry.ts`

Single registry mapping a `ModelKey` enum (`'train' | 'buildingA' |
'trafficLight' | ...`) to the result of `require('../../assets/models/foo.glb')`.
**Every GLB used in the app must be registered here.** Two helpers:

- `getModelAsset(key)` returns the asset module number or `null`.
- `getAllModelAssets()` returns every registered asset, used by
  `workout.tsx` to warm the cache during the loading overlay.

`MODELS_ENABLED` is currently `true`. The `getModelAsset` /
`getAllModelAssets` helpers short-circuit to `null` / `[]` when it's
false, which lets you disable every GLB in one place if you need to
A/B test the procedural fallbacks (every renderer that uses a GLB
has a procedural fallback).

### `src/components/scene/models/GLBModel.tsx`

The wrapper around `THREE.GLTFLoader`. Key props on `<GLBModel>`:

- `assetModule` (required) — the `require(...)` result.
- `position`, `rotation` (Vec3) — applied to the outer wrapper
  `<group>` AFTER the bbox fitting / ground-align below, so they're
  in world space regardless of model native scale.
- `scale` (number or Vec3, default 1) — applied to the wrapper
  group AFTER fit-scaling.
- `fitWidth` / `fitHeight` / `fitDepth` — auto-scale so the model's
  bounding box hits exactly that value on that axis. **Use these
  for any new GLB.** Quaternius models are 1 unit = 1m, Poly Pizza
  pieces are sometimes 100x. `fitWidth` is what makes
  `train.glb` end up at a usable lane-width even though its raw
  bbox is `0.081 x 0.021 x 0.032`.
- `groundAlign` (default `true`) — after fitting, places the
  model's bbox bottom at local y=0. This is what makes
  `position={[x, 0, z]}` "just work" for every prop without
  manually figuring out per-model offsets.
- `tint` — replaces material color on every mesh.
- `textureAssetModule` — the gotcha. See below.
- `sourceUp: 'y' | 'z'` — for Z-up models (some Poly Pizza city
  packs). Rotates the imported root before bbox fitting so
  "height" becomes world Y.
- `fallback` — `ReactNode` rendered while the GLB loads or if it
  fails. We pass procedural fallbacks for `trafficBarrier` and
  `overheadObstacle` so a broken asset still produces an obstacle
  the player can react to.

### Embedded textures broke on native (the big one)

`THREE.GLTFLoader` parses embedded `data:image/png;base64,...` chunks
inside GLB files. On Expo / native this **silently fails** for some
files — the geometry loads but every mesh comes out untextured (flat
colored). We can't tell from the API why; it's somewhere in the
Image / Canvas polyfill stack. We tried switching loaders, polyfilling
`Image`, and forcing draco; nothing worked reliably.

The pattern we settled on: **extract the texture as an external PNG,
register it alongside the GLB, and pass it via
`textureAssetModule`.**

Currently using this pattern:

- `trafficBarrier.glb` + `trafficBarrier.png` →
  `src/components/scene/Obstacle.tsx`
  (`TRAFFIC_BARRIER_TEXTURE = require('../../../assets/models/trafficBarrier.png')`,
  passed as `textureAssetModule` to `<GLBModel>`).
- `overheadObstacle.glb` + `overheadObstacle.png` →
  same file, `OVERHEAD_OBSTACLE_TEXTURE`.
- `trafficLight.glb` + `trafficLight.png` →
  `src/components/scene/EnvironmentChunk.tsx`
  (`TRAFFIC_LIGHT_TEXTURE`, passed only when rendering a
  `trafficLight` GLB).
- `maleOfficer.glb` + `maleOfficer.png` — the texture is on disk
  ready for use, but the cop-chase feature was cut, so neither
  the GLB nor the texture is referenced anymore.

Under the hood `GLBModel` loads the external texture via
`ExpoTextureLoader` from `expo-three/build/TextureLoader`, sets
`flipY: false` and `colorSpace: THREE.SRGBColorSpace`, and rebuilds
every material on the model (`cloneMaterialWithMods`): replaces
`.map`, sets `.color = white`, zeroes `metalness`, sets
`roughness = 1`. The result reads correctly against our scene
lighting.

If you add a GLB whose textures don't render on device:

1. Open the GLB in a tool that can extract embedded textures (Blender,
   gltf-transform CLI: `gltf-transform extract foo.glb out_dir/`).
2. Save the PNG next to the GLB in `assets/models/`.
3. `require()` it in the consuming component and pass it through
   `textureAssetModule`.

### Module caching

`GLBModel` keeps two module-scope `Map`s:

- `modelCache: Map<number, THREE.Group>` — keyed by the asset module
  number, holds the parsed source scene.
- `textureCache: Map<number, THREE.Texture>` — same idea for external
  textures.

Plus two `pendingLoads` / `pendingTextures` maps so concurrent
callers share one fetch instead of all kicking off their own.

`preloadModel(assetModule)` is exported for use by `workout.tsx`,
which preloads every asset returned by `getAllModelAssets()` before
flipping `isReady` to `true`. That's why the very first chunk
renders without a load hitch on each session.

### Per-instance cloning

Every `<GLBModel>` instance gets a fresh
`source.clone(true)` from the cache, then `applyMods` runs the
fit/scale/ground-align/material-tint/material-texture logic on that
clone in isolation. This is what lets a single `train.glb` source
be reused across dozens of train obstacles, the cargo container, AND
the roof-run trains without their transforms or materials clashing.

### Procedural fallbacks

When a GLB proved unreliable or just unnecessary, we fell back to
procedural geometry. Today's procedural-first scene elements:

- **`Ladder.tsx`** — replaced `ladder.glb`. Boxes + rails, easier to
  position relative to the train edges than rotating the GLB.
- **`AirplaneFlyby.tsx`** — never had a GLB; built procedurally
  from the start because we needed the contrail, banking, and
  arc-pitch.
- **`CartoonClouds.tsx`** — `cloudBackdrop.glb` exists but failed
  on native; we ship sphere clusters instead.
- **Bridge** — `bridge.glb` is on disk but unused. The original
  plan had bridges every few chunks; the GLB looked off, and there
  isn't currently a procedural bridge. If you want it, drop a new
  procedural component into `src/components/scene/` and mount it
  in `SubwayScene.tsx`.
- **Cop-chase dog** — `maleOfficer.glb` + `maleOfficer.png` are on
  disk but the cop-chase mechanic was dropped. Don't re-introduce
  it without a story arc; just having a cop run forever behind the
  player wasn't fun.

When in doubt, **prefer procedural** for anything that needs to be
positioned precisely (ladders against train edges, jump pads, lane
arrows) and **prefer GLB** for visual filler where exact placement
doesn't matter (skyline buildings, street props).

---

## 6. Running and testing

### Dev server

The Expo CLI is the entire dev story. Pick one of:

```bash
npx expo start                            # default LAN dev server
npx expo start --tunnel                   # ngrok tunnel (slow, but works behind NAT)
npx expo start --offline --port 8083      # offline + custom port (used during npm-trouble)
```

Then either:

- press `i` for the iOS simulator, OR
- scan the QR code with the Expo Go app on a physical iPhone.

The 3D scene needs a real GPU pipeline, so a physical device is
preferable. The iOS simulator works but is noticeably slower.
Android has not been tested recently and is not the target platform.

`@expo/ngrok ^4.1.3` is a devDependency, so `--tunnel` works without
extra installs (but see "Known node_modules gotcha" below).

### Type check

```bash
npx tsc --noEmit
```

This project is configured `strict: true` and should always pass
type-check. **Run it after every meaningful change.** Failures here
are typically the first signal that a refactor broke something
across files.

### Lint

```bash
npm run lint    # expo lint, wraps ESLint with the Expo defaults
```

We don't gate on lint, but if it errors after your change, fix it.

### Tests

**There are no automated tests wired up.** Visual / behavioural QA is
the main loop. The standard sweep:

1. Boot to the home screen — verify the stat row populates from
   AsyncStorage if you have prior sessions.
2. Tap `START WORKOUT`. The "GETTING READY" overlay should appear
   for ~0.5-1.5 seconds while every GLB preloads. The score is 0
   and the timer hasn't started yet — confirm both.
3. Once the overlay clears, watch AutoCamera react:
   - Barriers (orange jersey) → camera jumps.
   - Overheads (red crossing arm) → camera ducks.
   - Trains (colorful subway cars) → camera slides to a free lane.
   - HUD cue badge should match the action (and pre-cue a few
     meters out).
4. Wait for the first train roof-run section (it kicks in around
   chunk ~7, ~3 minutes in at default speed). Verify:
   - Camera climbs onto the trains on the ladder.
   - In a `'gap'` section the cue says `JUMP` at each gap.
   - In a `'lane'` section the cue says `JUMP LEFT` / `JUMP RIGHT`
     and the camera leaps between trains in different lanes.
   - Camera descends the exit ladder back to ground level.
5. Coin pickup — coins are in trails through chunks; when the
   camera flies through one, the count increments and you hear
   the `coin.mp3` SFX.
6. Pause button (top-left) → scene freezes, score ticker freezes,
   timer freezes; `END` button (bottom) appears.
7. Tap `END` → summary screen shows the duration + calorie estimate.
8. Tap `SAVE WORKOUT` → returns home, the session shows up in
   "Recent sessions".

### Known node_modules gotcha (the big tooling pothole)

An aborted `npm install` left **~66 packages** in a broken state
(missing or stub directories under `node_modules/`). We did NOT fix
this by re-running `npm install` — that hung indefinitely on this
network. Instead, **we patched the broken packages in by extracting
clean tarballs from npm via `npm pack` + `tar`.**

The `package-lock.json` itself is healthy and the project type-checks
and runs. So:

- **Do not run a fresh `npm install` unless you're prepared to
  babysit it.** If you do, and it hangs >5 minutes with no output,
  kill it and inspect what's actually missing from `node_modules/`
  rather than letting it sit. We've seen npm's lockfile
  reconciliation hang twice in this project on the same network
  conditions.
- Optional platform-mismatched packages (Linux/Windows ngrok
  binaries, `lightningcss-linux-*` / `lightningcss-win32-*`) are
  correctly absent on `darwin-arm64`. Don't try to install them.
- `.npmrc` has `legacy-peer-deps=true` because some R3F + React 19
  peer ranges don't agree; the `package.json` `overrides` block
  pins `expo-three`'s React to `19.1.0` for the same reason.

If you need to add a new package and `npm install` won't behave,
try one of:

```bash
npm install --offline                              # uses cache only
npm pack <package>@<version> && tar -xf ...        # the manual route
```

…before declaring war on the lockfile.

---

## 7. Design philosophy / things to keep in mind

The constraints we've followed so far. Diverging from these is fine
when there's a real reason — just know you're diverging.

### Procedural over GLB whenever the GLB is unreliable

GLB is great for visual filler where placement is approximate. It's
bad whenever you need precise alignment (rotating the ladder against
the train edge, positioning a jump trigger), and it's worse than bad
when textures fail silently on native. **If a piece of geometry has
to land at an exact world coordinate, build it procedurally.** The
ladder, the airplane, and the clouds all live here for that reason.

### Don't move the world; move the camera

The chunk recycler keeps the world fixed in world space and moves
the camera through it. The illusion of an "infinite" run is purely
the recycling cycle. The sky layer is locked to the camera so
distant elements feel infinitely far away. Anything you add should
respect this:

- New ground geometry → inside an `<EnvironmentChunk>` so it
  participates in recycling.
- New sky geometry → inside a group that locks to camera position
  (`CartoonClouds` is the template).
- New always-near-camera UI → React Native HUD, not a 3D HUD.

### HUD reflects the actual game state, not predictions about it

The cue badge value is sourced from `AutoCamera`'s own state machine
(`currentCue(s)` and `previewCue(s, ...)`), not from a separate
"what should the user do" controller. This is what keeps the cues
honest — when the cue says `JUMP LEFT`, the camera is about to /
already is jumping and leaping left, not just "should be". If you
introduce a new cue, publish it from inside AutoCamera and route it
through `onCueChange`.

### Strict scoping for additions

When a new system goes in (train roof-run, airplane, etc.), it
lives in NEW files and integrates at minimal points. The train
roof-run added `src/lib/roofRun.ts` + `TrainRoofRun.tsx` +
`Ladder.tsx`, and integrated with existing code via:

- One new `ObstacleKind` (`trainGap`) handled in `Obstacle.tsx` and
  `AutoCamera.tsx`.
- One optional field on `ChunkSpec` (`roofRun?: { role, variant, lane }`).
- A handful of helper calls from `AutoCamera` (`cameraBaseY`,
  `forcedLaneFor`, `upcomingRoofLane`) and `chunkManager`
  (`roofRunForStartZ`, `trainGapObstacleSpec`).

Existing components were NOT refactored "for cleanliness" alongside
the new feature. Resist the urge — every unrelated change in the
same PR is a regression risk.

### Performance: don't hitch during chunk recycling

`ForwardRunner` defers the React state update with
`requestAnimationFrame` + `startTransition` so the recycle never
runs inside the hot frame. `<EnvironmentChunk>` is `React.memo`'d
and `<Track>` uses stable `visual-chunk-${index}` keys so a
chunk-slot's React subtree stays mounted across recycles — the
chunk's `seed` and `startZ` change, but the subtree is re-rendered
in place, never unmounted. **Don't add code that re-mounts GLB
scenery during recycling** (e.g., using `chunk.id` as the
EnvironmentChunk key would re-mount the entire decor every recycle
and hitch hard).

Preloading every GLB at workout-screen mount (and only flipping
`isReady` once the cache is warm) is the other half of this. If you
add a new GLB, **make sure it's in `modelRegistry.ts` so
`getAllModelAssets()` picks it up** — otherwise the first appearance
in a chunk will hitch the frame.

---

## 8. Cheat-sheet: where to add common things

A quick where-to-touch list. The integration points are deliberately
small; resist adding "while I'm here" refactors at the same time.

### New obstacle kind

1. `src/lib/types.ts` — add the literal to `ObstacleKind`.
2. `src/components/scene/Obstacle.tsx` — add a `case` to the switch
   for the renderer (or return `null` if it's logic-only like
   `trainGap`).
3. `src/components/scene/AutoCamera.tsx` — add a `case` in the
   reaction switch inside `useFrame` (when idle and obstacle is in
   `REACT_DISTANCE`) and another in `previewCue`'s switch.
4. `src/components/scene/obstacleSpawner.ts` — decide whether the
   new kind enters the weighted random pool (`KIND_WEIGHTS`) or is
   spawned by some other system (e.g., `trainGap` is spawned by
   `chunkManager.buildRoofRunForChunk` only).

### New GLB asset

1. Drop the `.glb` into `assets/models/`.
2. Add a `ModelKey` literal and an `ASSET_MAP` entry to
   `src/lib/modelRegistry.ts`.
3. In your consuming component, call `getModelAsset('newKey')` and
   pass to `<GLBModel assetModule={...} fitWidth={...} ... />`.
   Specify exactly one of `fitWidth` / `fitHeight` / `fitDepth` so
   the model lands at a known world size; `groundAlign` defaults to
   true.
4. **Test on a physical device once.** If the model renders
   untextured (flat colored), extract the embedded texture to a PNG,
   save it next to the GLB, and pass it via `textureAssetModule`.

### New scene prop

Two paths:

- **GLB**: follow "New GLB asset" above, then mount it inside
  `<EnvironmentChunk>` (for per-chunk decor) or `<SubwayScene>`
  (for a singleton like the airplane).
- **Procedural**: create a new file under `src/components/scene/`
  using `<group>` / `<mesh>` / `<RoundedBox>` primitives. Mount in
  the same places. Prefer this when you need exact placement or
  when GLB textures keep misbehaving.

### New HUD cue

1. `src/lib/types.ts` — extend the `ActionCue` union.
2. `src/components/scene/AutoCamera.tsx` — publish it from
   `currentCue` or `previewCue` (or both). If it's a combined
   action like `jump-left`, you may also need state on
   `CameraState` (see `comboLeapDirection` for the pattern).
3. `src/components/hud/WorkoutHud.tsx` — add an entry to
   `CUE_CONTENT`.

### New screen

1. Add a `.tsx` file under `src/app/`. Typed routes are on, so the
   filename becomes the route.
2. If the screen should be a stack entry (with its own animation /
   gesture handling), add a `<Stack.Screen>` to
   `src/app/_layout.tsx`.
3. Navigate to it with `router.push('/your-screen')` (or `replace`).

---

## Appendix: oddities and parking-lot

A short list of things that exist in the repo but are not currently
wired up. None of them are blocking; included so you don't waste an
hour wondering "why is this here?".

- `src/components/hud/CountdownOverlay.tsx` — the old 3-2-1-GO
  intro. Replaced by the loading overlay in `workout.tsx`. Kept in
  case we want a countdown after the preload.
- `assets/models/bridge.glb`, `cloudBackdrop.glb`, `mountaintop.glb`,
  `maleOfficer.glb` (+ `.png`), `ladder.glb` — assets shipped for
  features that were cut or replaced with procedural equivalents.
- `assets/sounds/coin.wav` — unused; only `coin.mp3` is required by
  the audio player.
- `expo-sensors` is in `package.json` but currently unused. Motion-
  sensor controls were a roadmap item for v2.
- `expo-glass-effect`, `expo-symbols`, `@expo/ui` — pulled in by the
  Expo SDK 54 baseline but not actively referenced in src.
- `README.md`, `AGENTS.md`, `assets/models/README.md` — stale.
  This document supersedes them.

Welcome aboard. If you only read three files first, make them
`src/app/workout.tsx`, `src/components/scene/AutoCamera.tsx`, and
`src/lib/roofRun.ts` — in that order. Everything else hangs off
those three.

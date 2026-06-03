# Cardio Surf

A first-person, Subway Surfers-style **cardio backdrop** built in Expo. The
phone sits flat on a table (or propped facing you) while you do stationary
cardio - jumping, running, ducking - alongside an auto-running 3D scene. The
app tracks your time and estimates calories burned. No body tracking, no
controls; just visual immersion + a workout timer.

> v1 is intentionally minimal. Motion-sensor controls, multiple environments,
> music, accounts, and unlocks are deferred to later versions.

## Tech

- Expo SDK 56, TypeScript, expo-router
- `@react-three/fiber/native` + `three` + `expo-gl` + `expo-three` for 3D
- `@react-native-async-storage/async-storage` for local session history
- `expo-keep-awake` to keep the screen on during workouts

## Run it

```bash
cd cardiosurf
npm install            # already done if you cloned with deps
npx expo start         # press i for iOS sim, a for Android, or scan QR with Expo Go
```

The 3D scene needs a real GPU pipeline, so prefer:

- **iOS simulator** (works, but slower than a device)
- **A physical phone** via Expo Go (best)

## Project layout

```
src/
  app/
    _layout.tsx         expo-router root stack
    index.tsx           Home: start button, recent sessions, totals
    workout.tsx         Workout: 3D scene + HUD
    summary.tsx         Post-workout: save/discard
    settings.tsx        Weight, unit, clear history
  components/
    hud/
      WorkoutHud.tsx        translucent overlay
      CountdownOverlay.tsx  3-2-1-GO intro
    scene/
      SubwayScene.tsx       root Canvas + composition
      Lighting.tsx          ambient, directional, hemisphere
      Track.tsx             renders environment chunks
      EnvironmentChunk.tsx  one reusable section of subway
      ObstaclesField.tsx    renders all obstacles in current chunks
      Obstacle.tsx          barrier / overhead / wall prefabs
      ForwardRunner.tsx     camera forward motion + chunk recycling
      AutoCamera.tsx        lane changes, jumps, ducks
      chunkManager.ts       chunk pool / recycling logic
      obstacleSpawner.ts    per-chunk obstacle generator
  hooks/
    useWorkoutTimer.ts      paused/resumable elapsed timer
    useUserWeight.ts        loads user weight from AsyncStorage
  lib/
    constants.ts            lanes, speeds, durations, fog
    types.ts                Lane, ObstacleSpec, ChunkSpec, Session
    calories.ts             MET formula + duration formatting
    storage.ts              AsyncStorage helpers
    theme.ts                colors, spacing, radii
```

## How the runner works

- The 3D world is a chain of **chunks** (one chunk == 24m of subway).
- The camera advances at a constant -z speed; chunks that have fallen behind
  the camera are recycled to the front of the queue with new procedural decor
  and obstacles.
- Each chunk has up to 4 obstacle slots. A slot is either empty, a single
  obstacle, or two obstacles in lanes -1 and 1 (center always free).
- The **AutoCamera** scans the look-ahead window every frame. When it sees an
  obstacle in the current lane, it either changes lane (smooth lerp), jumps
  (parabolic arc), or ducks (sinusoidal dip), depending on the obstacle kind.

## Calorie estimate

Honest, simple MET-based estimate:

```
calories/min = (7.0 * 3.5 * weight_kg) / 200
```

The app uses 7.0 (moderate cardio) as the default MET. Users can set their
weight in Settings; estimates scale linearly with it.

## Roadmap / not in v1

- Motion-sensor controls (jump / lean detection via `expo-sensors`)
- Multiple environments (beach, neon city, space, forest)
- Music + SFX
- Achievements, streaks, daily goals
- Cloud sync / accounts
- Visible character (currently the player IS the camera)

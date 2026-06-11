# Handoff

The previous gameplay scene was removed and replaced with a fresh first-pass
endless runner scene.

## What Changed

- `src/app/workout.tsx` now launches the new gameplay scene and HUD.
- `src/components/scene/` and `src/components/hud/` were removed.
- Old gameplay helpers were removed from `src/lib/types.ts` and
  `src/lib/constants.ts`.
- `src/lib/modelRegistry.ts`, `src/lib/roofRun.ts`, and
  `src/hooks/useWorkoutTimer.ts` were removed.
- New gameplay components live under `src/components/gameplay/`.
- `Road.glb`, `Tunnel.glb`, and `Train.glb` live under
  `assets/models/gameplay/`.

## Still Present

- App navigation, onboarding, home, community, settings, summary, storage,
  profile/session types, calorie helpers, and theme values.
- Legacy media assets under `assets/`, kept as raw material for now.
- The new scene uses only the fresh gameplay GLBs and does not import the old
  scene files.

## Rebuild Starting Point

Start from `src/app/workout.tsx` and `src/components/gameplay/EndlessRoadScene.tsx`.
The first version has movement, chunk recycling, tunnels, trains, pause/reset,
and distance score. Lane switching, jumping, ducking, coins, collisions, and
game-over flow are still future work.

# Cardio Surf

An Expo / React Native cardio app with a fresh Subway Surfer-style endless
runner scene.

## Current State

- Home, onboarding, community, settings, summary, and local session storage are
  still in place.
- `/workout` launches a new React Three Fiber gameplay scene.
- The camera starts in the center lane and moves forward automatically.
- Road/tunnel chunks recycle to create an endless track.
- Trains spawn as lane obstacles.

## Tech

- Expo, TypeScript, expo-router
- `@react-three/fiber/native`, Three.js, and `expo-gl` for the gameplay scene
- `expo-asset` for bundled GLB assets
- `@react-native-async-storage/async-storage` for local session history
- React Native UI with shared theme values in `src/lib/theme.ts`

## Run It

```bash
npm install
npx expo start
```

## Project Layout

```text
src/
  app/
    _layout.tsx         expo-router root stack
    index.tsx           home
    workout.tsx         endless runner gameplay screen
    summary.tsx         post-workout save/discard flow
    settings.tsx        profile, preferences, local data controls
    community.tsx       leaderboard/feed shell
    onboarding/         first-run profile setup
  components/
    BottomTabBar.tsx    bottom navigation
    gameplay/           fresh endless runner scene
  hooks/
    useUserWeight.ts    profile weight helper
  lib/
    calories.ts         MET formula + duration formatting
    constants.ts        shared non-scene constants
    storage.ts          AsyncStorage helpers
    theme.ts            colors, spacing, radii
    types.ts            profile/session types
```

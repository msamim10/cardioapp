# CardioSurf Pose

This local Expo module owns the front-camera capture session and runs Apple's
`VNDetectHumanBodyPoseRequest` on-device at 10 FPS. It exists separately from
`expo-camera` because Expo Camera does not expose video frames to JavaScript.

## Build

The module is native and is not available in Expo Go or an already-installed
development client. After installing dependencies, create and install a fresh
iOS build:

```sh
npx expo prebuild --platform ios
npx expo run:ios --device
```

EAS development/preview/production builds run prebuild automatically, so a new
`eas build --platform ios --profile development` also includes the module.

The iOS Simulator and builds without this native module show **tracking
unavailable**; they never start simulated tracking automatically. For UI
development only, set `EXPO_PUBLIC_POSE_TRACKING_MODE=demo` in a development
build. Production builds ignore this flag.

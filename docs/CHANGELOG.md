# Changelog

All notable changes to CardioSurf are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-13

First cut of the streaming video experience: real full-length runner videos are
delivered to the app over the network instead of being bundled, plus the
Gen-Z-themed UI shell around them.

### Added

#### Streaming video levels (HLS)

- **Adaptive-bitrate streaming for runner levels.** Each runner "world" is
  streamed as an **HLS adaptive-bitrate ladder** (1080p / 720p / 480p / 360p)
  rather than bundled in the app or served as one giant file. The player reads a
  per-level `master.m3u8` and switches quality in real time to match the network,
  the same approach used by YouTube / TikTok / Netflix.
- **Cloud hosting via Google Cloud Storage.** Videos are hosted on
  Firebase Storage / GCS (`gs://cardiosurf-mvp-media`) and served over the public
  GCS URL so HLS's relative segment paths resolve. The base URL is configured with
  the `EXPO_PUBLIC_MEDIA_BASE_URL` environment variable (kept in `.env`, which is
  gitignored).
- **`expo-video` playback** using `AVPlayer` on iOS / `ExoPlayer` on Android.
- **Per-level, per-orientation sources.** Each level exposes a **vertical**
  (phone) and **horizontal** (TV) stream at
  `<base>/hls/<slug>/<orientation>/master.m3u8`.
- **Video source layer (`src/lib/videoSources.ts`).** Maps game level ids to
  storage slugs (`level1`, `level2`, …) and resolves the streamable URL for a
  requested orientation. Includes graceful fallback: if a level is missing one
  orientation it falls back to the other, and if both are missing the source
  resolves to `null` so the UI can show a "not available yet" state. Helpers:
  `getVideoSource`, `getPoster`, `hasVideo`, and `isMediaConfigured`.

#### Fullscreen workout player (`src/app/workout.tsx`)

- **Minimal, game-like fullscreen player.** Vertical HLS playback with
  `contentFit="cover"` and native controls disabled.
- **Distraction-free UI:** a single ✕ exit control, no pause/scrub controls, and
  a slim lime progress bar pinned to the bottom (safe-area aware).
- **Clear playback states:** a loading spinner ("Loading level…"), an error /
  "Level not ready yet" state for videos that aren't hosted yet, and a
  "Level not available yet" fallback (with a Continue action) when no streamable
  source is configured.
- **Keep-awake during runs** via `expo-keep-awake` so the screen doesn't sleep
  mid-workout.
- **Auto-advance to results:** when the video finishes playing it automatically
  routes to the summary screen.

#### App flow & content

- **Wired the run flow:** Level detail → Start → fullscreen workout player →
  summary.
- **Level catalog** of runner worlds, each backed by a hosted video, defined in
  `src/lib/gameData.ts` (with featured level, daily challenges, and difficulty
  multipliers).

#### UI/UX shell

- **Gen-Z-themed screens:** Home, Levels, Level detail, Summary, and Profile.
- **Custom tab bar** and a shared **design system / theme** (colors, spacing,
  radius, typography) with reusable UI components (e.g. `GradientButton`).

### Documentation

- Added `docs/VIDEO_HOSTING.md` describing the streaming architecture, the live
  GCS setup, the transcode / master-playlist / upload pipeline scripts, and cost
  and security notes.

### Known limitations

- Some levels do not yet have both orientation variants uploaded (the video
  transcode/upload pipeline is handled separately). Levels missing a variant fall
  back to the other orientation, and levels with no usable source show the
  in-app "not ready yet" state instead of failing.

[0.1.0]: https://github.com/msamim10/cardioapp/releases/tag/v0.1.0

/**
 * GLB model registry - DISABLED.
 *
 * The runner scene is now fully hand-built from stylized procedural
 * geometry (see src/components/scene/), so no downloaded GLB assets are
 * registered or bundled. The registry API is kept so the workout screen's
 * preload flow keeps working; it simply has nothing to preload.
 */

export const MODELS_ENABLED = false;

export type ModelKey = never;

export function getModelAsset(_key: ModelKey): number | null {
  return null;
}

/** All registered GLB assets - used by the workout screen to preload. */
export function getAllModelAssets(): number[] {
  return [];
}

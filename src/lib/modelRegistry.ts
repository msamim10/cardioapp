/**
 * Optional GLB model registry.
 *
 * Cardio Surf can render its trains and buildings as either:
 *   (a) hand-built primitives (the default - zero downloads required), OR
 *   (b) real CC0 GLB models from Quaternius / Kenney / Poly Pizza.
 *
 * To switch to real models:
 *   1. Follow assets/models/README.md to download the GLB files.
 *   2. Drop them into assets/models/ with the EXACT filenames listed below.
 *   3. Uncomment the requires below.
 *   4. Set MODELS_ENABLED to true.
 *
 * The app will automatically use the GLB models. If anything is missing it
 * falls back to the primitives so nothing breaks.
 */

export const MODELS_ENABLED = true;

export type ModelKey =
  | 'train'
  | 'trainCargoContainer'
  | 'buildingA'
  | 'buildingB'
  | 'buildingC'
  | 'buildingD'
  | 'buildingE'
  | 'buildingF'
  | 'trafficLight'
  | 'billboard'
  | 'trafficBarrier'
  | 'overheadObstacle'
  | 'busStop'
  | 'busStopSign'
  | 'stopSign'
  | 'fireHydrant'
  | 'fireExit'
  | 'washingLine'
  | 'trashCan'
  | 'bench'
  | 'tree'
  | 'mailbox'
  | 'dumpster'
  | 'cone'
  | 'ladder';

const ASSET_MAP: Record<ModelKey, number> = {
  train: require('../../assets/models/train.glb'),
  trainCargoContainer: require('../../assets/models/trainCargoContainer.glb'),
  buildingA: require('../../assets/models/buildingA.glb'),
  buildingB: require('../../assets/models/buildingB.glb'),
  buildingC: require('../../assets/models/buildingC.glb'),
  buildingD: require('../../assets/models/buildingD.glb'),
  buildingE: require('../../assets/models/buildingE.glb'),
  buildingF: require('../../assets/models/buildingF.glb'),
  trafficLight: require('../../assets/models/trafficLight.glb'),
  billboard: require('../../assets/models/billboard.glb'),
  trafficBarrier: require('../../assets/models/trafficBarrier.glb'),
  overheadObstacle: require('../../assets/models/overheadObstacle.glb'),
  busStop: require('../../assets/models/busStop.glb'),
  busStopSign: require('../../assets/models/busStopSign.glb'),
  stopSign: require('../../assets/models/stopSign.glb'),
  fireHydrant: require('../../assets/models/fireHydrant.glb'),
  fireExit: require('../../assets/models/fireExit.glb'),
  washingLine: require('../../assets/models/washingLine.glb'),
  trashCan: require('../../assets/models/trashCan.glb'),
  bench: require('../../assets/models/bench.glb'),
  tree: require('../../assets/models/tree.glb'),
  mailbox: require('../../assets/models/mailbox.glb'),
  dumpster: require('../../assets/models/dumpster.glb'),
  cone: require('../../assets/models/cone.glb'),
  ladder: require('../../assets/models/ladder.glb'),
};

export function getModelAsset(key: ModelKey): number | null {
  if (!MODELS_ENABLED) return null;
  return ASSET_MAP[key] ?? null;
}

/** All registered GLB assets - used by the workout screen to preload. */
export function getAllModelAssets(): number[] {
  if (!MODELS_ENABLED) return [];
  return Object.values(ASSET_MAP).filter((v): v is number => typeof v === 'number');
}

/** City Builder Bits (Poly Pizza / Kay Lousberg) GLB registry. */

export type CityModelKey =
  | 'base'
  | 'bench'
  | 'box'
  | 'boxB'
  | 'buildingA'
  | 'buildingB'
  | 'buildingC'
  | 'buildingD'
  | 'buildingE'
  | 'buildingF'
  | 'buildingG'
  | 'buildingH'
  | 'bush'
  | 'carHatchback'
  | 'dumpster'
  | 'fireHydrant'
  | 'policeCar'
  | 'roadBits'
  | 'rocks'
  | 'stationwagon'
  | 'streetlight'
  | 'taxi'
  | 'trafficLight'
  | 'trafficLightB'
  | 'watertower';

const ASSET_MAP: Record<CityModelKey, number> = {
  base: require('../../assets/city-builder-bits/base.glb'),
  bench: require('../../assets/city-builder-bits/bench.glb'),
  box: require('../../assets/city-builder-bits/box.glb'),
  boxB: require('../../assets/city-builder-bits/box-b.glb'),
  buildingA: require('../../assets/city-builder-bits/building-a.glb'),
  buildingB: require('../../assets/city-builder-bits/building-b.glb'),
  buildingC: require('../../assets/city-builder-bits/building-c.glb'),
  buildingD: require('../../assets/city-builder-bits/building-d.glb'),
  buildingE: require('../../assets/city-builder-bits/building-e.glb'),
  buildingF: require('../../assets/city-builder-bits/building-f.glb'),
  buildingG: require('../../assets/city-builder-bits/building-g.glb'),
  buildingH: require('../../assets/city-builder-bits/building-h.glb'),
  bush: require('../../assets/city-builder-bits/bush.glb'),
  carHatchback: require('../../assets/city-builder-bits/car-hatchback.glb'),
  dumpster: require('../../assets/city-builder-bits/dumpster.glb'),
  fireHydrant: require('../../assets/city-builder-bits/fire-hydrant.glb'),
  policeCar: require('../../assets/city-builder-bits/police-car.glb'),
  roadBits: require('../../assets/city-builder-bits/road-bits.glb'),
  rocks: require('../../assets/city-builder-bits/rocks.glb'),
  stationwagon: require('../../assets/city-builder-bits/stationwagon.glb'),
  streetlight: require('../../assets/city-builder-bits/streetlight.glb'),
  taxi: require('../../assets/city-builder-bits/taxi.glb'),
  trafficLight: require('../../assets/city-builder-bits/traffic-light.glb'),
  trafficLightB: require('../../assets/city-builder-bits/traffic-light-b.glb'),
  watertower: require('../../assets/city-builder-bits/watertower.glb'),
};

/**
 * Shared 1024x1024 colour atlas used by every City Builder Bits model.
 * The embedded copy is stripped from each GLB (Expo's GLTFLoader cannot
 * decode embedded PNGs), so it is bundled separately and re-applied to the
 * model materials at runtime using each mesh's preserved UVs.
 */
const CITY_ATLAS: number = require('../../assets/city-builder-bits/citybits_atlas.png');

export function getCityAsset(key: CityModelKey): number {
  return ASSET_MAP[key];
}

export function getCityAtlas(): number {
  return CITY_ATLAS;
}

export function getCityPreloadAssets(): number[] {
  return Object.values(ASSET_MAP);
}

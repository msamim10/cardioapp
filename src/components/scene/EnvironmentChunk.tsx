import { memo, useMemo } from 'react';
import { CHUNK_LENGTH, LANE_X } from '@/lib/constants';
import { getCityAsset, getCityAtlas, type CityModelKey } from '@/lib/cityBuilderRegistry';
import { RAMP_ANGLE, RAMP_END_Z, groundHeightAtZ, isOnRamp } from '@/lib/terrain';
import type { WorkoutSceneVariant } from '@/lib/types';
import { GLBModel } from './models/GLBModel';

type Props = {
  startZ: number;
  seed?: number;
  variant?: WorkoutSceneVariant;
};

const ROAD_WIDTH = 6.8;
const SIDEWALK_WIDTH = 2.4;
const SIDEWALK_X = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2;
const BUILDING_X = ROAD_WIDTH / 2 + SIDEWALK_WIDTH + 4.2;
const PROP_CURB_X = ROAD_WIDTH / 2 + 0.7;
const PROP_SIDEWALK_X = ROAD_WIDTH / 2 + 1.7;

// The run begins inside a tunnel that climbs the ramp up to the city. The
// tunnel spans the ramp region (startZ down to RAMP_END_Z); everything past it
// is the open, elevated city. Because recycled chunks always get a MORE
// negative startZ, the tunnel only ever appears once, at the start of the run.
const TUNNEL_HALF_W = 4.6;
const TUNNEL_H = 5.6;

const ATLAS = getCityAtlas();

type BuildingKey = Extract<
  CityModelKey,
  | 'buildingA'
  | 'buildingB'
  | 'buildingC'
  | 'buildingD'
  | 'buildingE'
  | 'buildingF'
  | 'buildingG'
  | 'buildingH'
  | 'watertower'
>;

type PropKey = Extract<
  CityModelKey,
  | 'bench'
  | 'box'
  | 'boxB'
  | 'bush'
  | 'dumpster'
  | 'fireHydrant'
  | 'rocks'
  | 'streetlight'
  | 'trafficLight'
  | 'trafficLightB'
>;

type CityBuildingSpec = {
  key: BuildingKey;
  side: -1 | 1;
  z: number;
  height: number;
  rotY: number;
};

type CityPropSpec = {
  key: PropKey;
  side: -1 | 1;
  x: number;
  z: number;
  rotY: number;
};

const BUILDING_KEYS: BuildingKey[] = [
  'buildingA',
  'buildingB',
  'buildingC',
  'buildingD',
  'buildingE',
  'buildingF',
  'buildingG',
  'buildingH',
];

const PROP_KEYS: PropKey[] = [
  'bench',
  'box',
  'boxB',
  'bush',
  'dumpster',
  'fireHydrant',
  'rocks',
  'streetlight',
  'trafficLight',
  'trafficLightB',
];

const CURB_PROPS = new Set<PropKey>([
  'streetlight',
  'trafficLight',
  'trafficLightB',
  'fireHydrant',
  'bush',
  'rocks',
]);

/**
 * City runner chunk assembled from City Builder Bits GLB pieces.
 * The center road stays clear for three-lane gameplay; buildings and props
 * only frame the sides of the runner path.
 */
function EnvironmentChunkComponent({ startZ, seed = 0, variant = 'city-builder' }: Props) {
  const centerZ = -CHUNK_LENGTH / 2;
  const isCity = variant === 'city-builder';
  const isTunnel = isCity && startZ > RAMP_END_Z;
  // The exit chunk is the last tunnel chunk: its far edge crosses the ramp end.
  const isTunnelExit = isTunnel && startZ - CHUNK_LENGTH <= RAMP_END_Z;

  // Place + tilt the chunk so its floor follows the elevation profile. Ramp
  // chunks are rotated about X so their floors join into one continuous climb;
  // flat chunks (the start approach and the elevated city) stay level.
  const centerWorldZ = startZ - CHUNK_LENGTH / 2;
  const onRamp = isCity && isOnRamp(centerWorldZ);
  const groupY = isCity ? groundHeightAtZ(startZ) : 0;
  const groupTilt = onRamp ? RAMP_ANGLE : 0;

  const decor = useMemo(() => {
    const rng = mulberry32(seed >>> 0 || 1);
    const buildings: CityBuildingSpec[] = [];
    const props: CityPropSpec[] = [];

    if (variant === 'city-builder') {
      for (const side of [-1, 1] as const) {
        const perSide = 3;
        for (let i = 0; i < perSide; i++) {
          // Occasionally drop a water tower in to break up the skyline.
          const useTower = rng() > 0.82;
          buildings.push({
            key: useTower
              ? 'watertower'
              : BUILDING_KEYS[Math.floor(rng() * BUILDING_KEYS.length)],
            side,
            z: -(i + 0.5) * (CHUNK_LENGTH / perSide) + (rng() - 0.5) * 1.4,
            height: useTower ? 5.5 + rng() * 1.5 : 9 + rng() * 6,
            rotY: Math.floor(rng() * 4) * (Math.PI / 2),
          });
        }
      }

      const propCount = 5 + Math.floor(rng() * 3);
      for (let i = 0; i < propCount; i++) {
        const side = rng() > 0.5 ? 1 : -1;
        const key = PROP_KEYS[Math.floor(rng() * PROP_KEYS.length)];
        const onCurb = CURB_PROPS.has(key);
        props.push({
          key,
          side,
          x: (onCurb ? PROP_CURB_X : PROP_SIDEWALK_X) * side,
          z: -2 - rng() * (CHUNK_LENGTH - 4),
          rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        });
      }
    }

    const arrows: { x: number; z: number }[] = [];
    if (rng() > 0.45) {
      const lane = ([-1, 0, 1] as const)[Math.floor(rng() * 3)];
      arrows.push({
        x: LANE_X[lane.toString() as '-1' | '0' | '1'],
        z: -4 - rng() * (CHUNK_LENGTH - 8),
      });
    }

    return { buildings, props, arrows };
  }, [seed, variant]);

  return (
    <group position={[0, groupY, startZ]} rotation={[groupTilt, 0, 0]}>
      {variant === 'city-builder' ? (
        isTunnel ? (
          <TunnelChunk isExit={isTunnelExit} />
        ) : (
          <CityChunk centerZ={centerZ} buildings={decor.buildings} props={decor.props} seed={seed} />
        )
      ) : (
        <SimpleRunnerChunk centerZ={centerZ} />
      )}

      {/* Lane guide stripes. */}
      {[-0.8, 0.8].map((x) => (
        <group key={`lane-stripe-${x}`} position={[x, 0.09, centerZ]}>
          {Array.from({ length: 6 }).map((_, i) => (
            <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -i * 4 - 1]}>
              <planeGeometry args={[0.08, 1.6]} />
              <meshBasicMaterial color="#f8fafc" />
            </mesh>
          ))}
        </group>
      ))}

      {decor.arrows.map((a, i) => (
        <BoostArrow key={`arrow-${i}`} x={a.x} z={a.z} />
      ))}
    </group>
  );
}

function CityChunk({
  centerZ,
  buildings,
  props,
  seed,
}: {
  centerZ: number;
  buildings: CityBuildingSpec[];
  props: CityPropSpec[];
  seed: number;
}) {
  return (
    <group>
      {/* Grass / lot ground that fills behind the sidewalks. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, centerZ]}>
        <planeGeometry args={[40, CHUNK_LENGTH]} />
        <meshLambertMaterial color="#6b7b53" />
      </mesh>

      {/* Asphalt road surface. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, centerZ]}>
        <planeGeometry args={[ROAD_WIDTH, CHUNK_LENGTH]} />
        <meshLambertMaterial color="#2f343b" />
      </mesh>

      {/* Curbs separate the road from the sidewalks. */}
      {([-1, 1] as const).map((side) => (
        <mesh key={`curb-${side}`} position={[side * (ROAD_WIDTH / 2 + 0.05), 0.1, centerZ]}>
          <boxGeometry args={[0.14, 0.2, CHUNK_LENGTH]} />
          <meshLambertMaterial color="#d6dae0" />
        </mesh>
      ))}

      {/* Sidewalk strips. */}
      {([-1, 1] as const).map((side) => (
        <mesh key={`sidewalk-${side}`} position={[SIDEWALK_X * side, 0.04, centerZ]}>
          <boxGeometry args={[SIDEWALK_WIDTH, 0.12, CHUNK_LENGTH]} />
          <meshLambertMaterial color={side > 0 ? '#9aa3ad' : '#8f98a3'} />
        </mesh>
      ))}

      {buildings.map((building, i) => (
        <GLBModel
          key={`building-${i}`}
          assetModule={getCityAsset(building.key)}
          atlasModule={ATLAS}
          fitHeight={building.height}
          position={[BUILDING_X * building.side, 0, building.z]}
          rotation={[0, building.rotY, 0]}
          fallback={<BuildingFallback spec={building} />}
        />
      ))}

      {props.map((prop, i) => {
        const fit = propFit(prop.key);
        return (
          <GLBModel
            key={`prop-${i}`}
            assetModule={getCityAsset(prop.key)}
            atlasModule={ATLAS}
            fitWidth={fit.w}
            fitHeight={fit.h}
            fitDepth={fit.d}
            position={[prop.x, 0.06, prop.z]}
            rotation={[0, prop.rotY, 0]}
            fallback={<PropFallback spec={prop} />}
          />
        );
      })}

      {seed === 1 && <CityBanner z={-5.2} />}
    </group>
  );
}

function SimpleRunnerChunk({ centerZ }: { centerZ: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, centerZ]}>
      <planeGeometry args={[ROAD_WIDTH, CHUNK_LENGTH]} />
      <meshLambertMaterial color="#2f343b" />
    </mesh>
  );
}

/**
 * Enclosed starting tunnel. Full-length tunnel chunks are sealed walls +
 * ceiling with light strips and arch ribs; the exit chunk stops the tunnel
 * partway through and frames a bright portal that opens onto the city road.
 */
function TunnelChunk({ isExit }: { isExit: boolean }) {
  const len = isExit ? CHUNK_LENGTH * 0.55 : CHUNK_LENGTH;
  const segZ = -len / 2;
  const ribCount = Math.max(2, Math.round(len / 3));
  const lightCount = Math.max(2, Math.round(len / 5));
  return (
    <group>
      {/* Tunnel floor (dark asphalt). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, segZ]}>
        <planeGeometry args={[TUNNEL_HALF_W * 2, len]} />
        <meshLambertMaterial color="#23262b" />
      </mesh>

      {/* Side walls. */}
      {([-1, 1] as const).map((side) => (
        <mesh key={`wall-${side}`} position={[side * TUNNEL_HALF_W, TUNNEL_H / 2, segZ]}>
          <boxGeometry args={[0.6, TUNNEL_H, len]} />
          <meshLambertMaterial color="#3a3f47" />
        </mesh>
      ))}

      {/* Glowing service stripe low on each wall. */}
      {([-1, 1] as const).map((side) => (
        <mesh key={`trim-${side}`} position={[side * (TUNNEL_HALF_W - 0.32), 1.0, segZ]}>
          <boxGeometry args={[0.06, 0.4, len]} />
          <meshBasicMaterial color="#7fb2d6" />
        </mesh>
      ))}

      {/* Ceiling slab. */}
      <mesh position={[0, TUNNEL_H, segZ]}>
        <boxGeometry args={[TUNNEL_HALF_W * 2 + 0.6, 0.5, len]} />
        <meshLambertMaterial color="#2b2f35" />
      </mesh>

      {/* Arch ribs at intervals. */}
      {Array.from({ length: ribCount }).map((_, i) => (
        <TunnelRib key={`rib-${i}`} z={-(i + 0.5) * (len / ribCount)} />
      ))}

      {/* Ceiling light strips. */}
      {Array.from({ length: lightCount }).map((_, i) => (
        <mesh
          key={`light-${i}`}
          position={[0, TUNNEL_H - 0.36, -(i + 0.5) * (len / lightCount)]}
        >
          <boxGeometry args={[1.4, 0.12, 0.55]} />
          <meshBasicMaterial color="#fff4c9" />
        </mesh>
      ))}

      {isExit && (
        <>
          <TunnelPortal z={-len} />
          {/* Open city road beyond the tunnel mouth. */}
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.005, -(len + (CHUNK_LENGTH - len) / 2)]}
          >
            <planeGeometry args={[ROAD_WIDTH, CHUNK_LENGTH - len]} />
            <meshLambertMaterial color="#2f343b" />
          </mesh>
          {/* Daylight glow filling the portal opening. */}
          <mesh position={[0, TUNNEL_H / 2, -len + 0.06]}>
            <planeGeometry args={[TUNNEL_HALF_W * 2, TUNNEL_H]} />
            <meshBasicMaterial color="#e4f1ff" transparent opacity={0.4} />
          </mesh>
        </>
      )}
    </group>
  );
}

function TunnelRib({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, TUNNEL_H - 0.2, 0]}>
        <boxGeometry args={[TUNNEL_HALF_W * 2, 0.4, 0.4]} />
        <meshLambertMaterial color="#21252b" />
      </mesh>
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[side * (TUNNEL_HALF_W - 0.25), TUNNEL_H / 2, 0]}>
          <boxGeometry args={[0.4, TUNNEL_H, 0.4]} />
          <meshLambertMaterial color="#21252b" />
        </mesh>
      ))}
    </group>
  );
}

function TunnelPortal({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[side * (TUNNEL_HALF_W + 0.2), TUNNEL_H / 2, 0]}>
          <boxGeometry args={[0.7, TUNNEL_H + 0.6, 0.7]} />
          <meshLambertMaterial color="#e2a23b" />
        </mesh>
      ))}
      <mesh position={[0, TUNNEL_H + 0.3, 0]}>
        <boxGeometry args={[TUNNEL_HALF_W * 2 + 1.4, 0.7, 0.7]} />
        <meshLambertMaterial color="#e2a23b" />
      </mesh>
      {/* Hazard band across the top beam. */}
      <mesh position={[0, TUNNEL_H + 0.3, 0.36]}>
        <planeGeometry args={[TUNNEL_HALF_W * 2 + 1.4, 0.5]} />
        <meshBasicMaterial color="#f5d76e" />
      </mesh>
    </group>
  );
}

/** Target fit dimensions (meters) per prop so the tiny source models read well. */
function propFit(key: PropKey): { w?: number; h?: number; d?: number } {
  switch (key) {
    case 'streetlight':
      return { h: 3.0 };
    case 'trafficLight':
    case 'trafficLightB':
      return { h: 2.6 };
    case 'bench':
      return { w: 1.4 };
    case 'dumpster':
      return { w: 1.5 };
    case 'fireHydrant':
      return { h: 0.95 };
    case 'bush':
      return { h: 1.1 };
    case 'box':
      return { h: 0.85 };
    case 'boxB':
      return { h: 0.7 };
    case 'rocks':
      return { w: 1.2 };
    default:
      return { h: 1.0 };
  }
}

function BuildingFallback({ spec }: { spec: CityBuildingSpec }) {
  const color = spec.side > 0 ? '#7891a8' : '#a87f6a';
  const height = spec.height;
  const footprint = 4.5;
  return (
    <group position={[BUILDING_X * spec.side, 0, spec.z]}>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[footprint, height, footprint]} />
        <meshLambertMaterial color={color} />
      </mesh>
    </group>
  );
}

function PropFallback({ spec }: { spec: CityPropSpec }) {
  const color =
    spec.key === 'dumpster'
      ? '#3f7d52'
      : spec.key === 'bush'
        ? '#3f9d4a'
        : spec.key === 'rocks'
          ? '#94a3b8'
          : '#475569';
  return (
    <mesh position={[spec.x, 0.5, spec.z]}>
      <boxGeometry args={[0.5, 1, 0.5]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

function CityBanner({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      {[-1, 1].map((side) => (
        <mesh key={`post-${side}`} position={[side * 3.55, 1.9, 0]}>
          <boxGeometry args={[0.14, 3.8, 0.14]} />
          <meshLambertMaterial color="#1f2937" />
        </mesh>
      ))}
      <mesh position={[0, 3.2, 0]}>
        <boxGeometry args={[5.8, 0.72, 0.14]} />
        <meshLambertMaterial color="#8b5cf6" />
      </mesh>
      {/* Blocky fake text marks the city scene without font geometry. */}
      {Array.from({ length: 11 }).map((_, i) => (
        <mesh key={i} position={[-2.25 + i * 0.45, 3.2, -0.09]}>
          <boxGeometry args={[0.24, 0.28, 0.04]} />
          <meshBasicMaterial color="#fef3c7" />
        </mesh>
      ))}
    </group>
  );
}

function BoostArrow({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.025, z]} rotation={[-Math.PI / 2, 0, 0]}>
      {[0, 0.6, 1.2].map((dz, i) => (
        <group key={i} position={[0, -dz, 0]}>
          <mesh position={[-0.35, 0, 0]} rotation={[0, 0, Math.PI / 4]}>
            <planeGeometry args={[0.6, 0.18]} />
            <meshBasicMaterial color="#fde047" />
          </mesh>
          <mesh position={[0.35, 0, 0]} rotation={[0, 0, -Math.PI / 4]}>
            <planeGeometry args={[0.6, 0.18]} />
            <meshBasicMaterial color="#fde047" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EnvironmentChunk = memo(EnvironmentChunkComponent);

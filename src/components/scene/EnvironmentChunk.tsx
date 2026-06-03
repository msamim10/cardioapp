import { memo, useMemo } from 'react';
import { ARCADE_PALETTE, CHUNK_LENGTH, GROUND_COLOR, LANE_X, TRACK_WIDTH } from '@/lib/constants';
import { getModelAsset, type ModelKey } from '@/lib/modelRegistry';
import { Building, type BuildingSpec } from './buildings';
import { GLBModel } from './models/GLBModel';
import { RoundedBox } from './RoundedBox';
import { StreetProp, type StreetPropSpec } from './StreetProps';

type Props = {
  startZ: number;
  seed?: number;
};

const HALF_WIDTH = TRACK_WIDTH / 2;
const TIE_SPACING = 1.4;
const RAIL_OFFSET = 0.55;
const SIDE_BARRIER_INSET = 0.25;
const BARRIER_HEIGHT = 0.95;
const BARRIER_WIDTH = 0.5;
const FENCE_POST_SPACING = 3.0;
const TRAFFIC_LIGHT_RAIL_Y = BARRIER_HEIGHT + 0.05;

type CityPropKey = Extract<
  ModelKey,
  | 'trafficLight'
  | 'billboard'
  | 'busStop'
  | 'busStopSign'
  | 'stopSign'
  | 'fireHydrant'
  | 'trashCan'
  | 'bench'
  | 'tree'
  | 'mailbox'
  | 'dumpster'
  | 'cone'
>;

type CityGltfProp = {
  kind: CityPropKey;
  side: -1 | 1;
  x: number;
  z: number;
  rotY: number;
};

const CITY_PROP_HEIGHTS: Record<CityPropKey, number> = {
  trafficLight: 2.45,
  billboard: 2.15,
  busStop: 1.65,
  busStopSign: 1.6,
  stopSign: 1.25,
  fireHydrant: 0.55,
  trashCan: 0.7,
  bench: 0.62,
  tree: 2.35,
  mailbox: 0.75,
  dumpster: 0.82,
  cone: 0.42,
};

const TRAFFIC_LIGHT_TEXTURE = require('../../../assets/models/trafficLight.png');

const CITY_PROP_KEYS: CityPropKey[] = [
  'trafficLight',
  'billboard',
  'stopSign',
  'fireHydrant',
  'trashCan',
  'bench',
  'tree',
  'mailbox',
  'dumpster',
  'cone',
];

/**
 * One reusable chunk of OUTDOOR cartoon subway environment.
 * Bright arcade palette, rounded geometry, painted graffiti on buildings
 * and barriers. No ceiling / no walls - open sky.
 */
function EnvironmentChunkComponent({ startZ, seed = 0 }: Props) {
  const centerZ = -CHUNK_LENGTH / 2;

  const decor = useMemo(() => {
    const rng = mulberry32(seed >>> 0 || 1);

    const tieCount = Math.floor(CHUNK_LENGTH / TIE_SPACING);
    const ties: { z: number }[] = [];
    for (let i = 0; i < tieCount; i++) {
      ties.push({ z: -i * TIE_SPACING - TIE_SPACING / 2 });
    }

    // Skyline - 5 buildings per side, close enough to read as a dense city wall.
    const buildings: BuildingSpec[] = [];
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 5; i++) {
        const variant = Math.floor(rng() * 7);
        const width = 3.0 + rng() * 2.6;
        const depth = 2.6 + rng() * 1.6;
        // GLB city assets are broad after fitting. Keep them skyline-sized
        // and push them well beyond the barriers so they never overlap lanes.
        const height = 6.4 + rng() * 3.4;
        const baseX = (HALF_WIDTH + 2.25) * side;
        const jitterX = rng() * 0.25;
        const z = -(i + 0.45) * (CHUNK_LENGTH / 5) - rng() * 0.55;
        const bodyColor = ARCADE_PALETTE.buildings[
          Math.floor(rng() * ARCADE_PALETTE.buildings.length)
        ];
        let accentColor = ARCADE_PALETTE.buildings[
          Math.floor(rng() * ARCADE_PALETTE.buildings.length)
        ];
        // Ensure accent != body for visual contrast
        if (accentColor === bodyColor) {
          accentColor = ARCADE_PALETTE.graffiti[
            Math.floor(rng() * ARCADE_PALETTE.graffiti.length)
          ];
        }
        buildings.push({
          variant,
          x: baseX + jitterX * side,
          z,
          width,
          depth,
          height,
          bodyColor,
          accentColor,
          windowRows: Math.max(2, Math.floor(height / 1.5)),
          hasGraffiti: rng() > 0.35,
          graffitiSeed: Math.floor(rng() * 100000) + seed,
          hasRoofBox: rng() > 0.45,
          hasSign: rng() > 0.55,
          hasFireExit: rng() > 0.58,
          hasWashingLine: rng() > 0.62,
          hasSideBusStop: rng() > 0.72,
          signColor: ARCADE_PALETTE.graffiti[
            Math.floor(rng() * ARCADE_PALETTE.graffiti.length)
          ],
          facingIn: side === 1 ? 1 : -1, // building's graffiti always faces the track
        });
      }
    }

    const posts: { x: number; z: number }[] = [];
    const postCount = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < postCount; i++) {
      const side = rng() > 0.5 ? 1 : -1;
      const x = (HALF_WIDTH + 0.6) * side;
      const z = -3 - rng() * (CHUNK_LENGTH - 6);
      posts.push({ x, z });
    }

    const fencePosts: { side: -1 | 1; z: number }[] = [];
    const fenceCount = Math.ceil(CHUNK_LENGTH / FENCE_POST_SPACING);
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < fenceCount; i++) {
        fencePosts.push({
          side,
          z: -i * FENCE_POST_SPACING - FENCE_POST_SPACING / 2,
        });
      }
    }

    // Painted boost arrows on the ground (1-2 per chunk)
    const arrows: { x: number; z: number }[] = [];
    if (rng() > 0.4) {
      const lane = ([-1, 0, 1] as const)[Math.floor(rng() * 3)];
      arrows.push({
        x: LANE_X[lane.toString() as '-1' | '0' | '1'],
        z: -4 - rng() * (CHUNK_LENGTH - 8),
      });
    }

    // Stickers / posters on side jersey barriers (1-2 per side per chunk)
    const stickers: {
      side: -1 | 1;
      z: number;
      color: string;
      shape: 'circle' | 'rect';
    }[] = [];
    for (const side of [-1, 1] as const) {
      const count = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i++) {
        stickers.push({
          side,
          z: -2 - rng() * (CHUNK_LENGTH - 4),
          color: ARCADE_PALETTE.graffiti[
            Math.floor(rng() * ARCADE_PALETTE.graffiti.length)
          ],
          shape: rng() > 0.5 ? 'circle' : 'rect',
        });
      }
    }

    // Street props in the strip between the barrier and the buildings.
    // 2-4 per chunk total, sparse so they don't overcrowd.
    const propKinds: StreetPropSpec['kind'][] = [
      'hydrant', 'trashcan', 'bench', 'vendor', 'stopsign', 'newsbox',
    ];
    const propCount = 2 + Math.floor(rng() * 3);
    const props: StreetPropSpec[] = [];
    for (let i = 0; i < propCount; i++) {
      const side = rng() > 0.5 ? 1 : -1;
      const kind = propKinds[Math.floor(rng() * propKinds.length)];
      // The vendor stall is wider so push it a bit further out.
      const lateralOffset = kind === 'vendor' ? 1.2 : 0.7;
      const x = (HALF_WIDTH + SIDE_BARRIER_INSET + BARRIER_WIDTH / 2 + lateralOffset) * side
        + (rng() - 0.5) * 0.4;
      const z = -2 - rng() * (CHUNK_LENGTH - 4);
      // Face inward toward the track
      const rotY = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      props.push({
        kind,
        x,
        z,
        rotY: rotY + (rng() - 0.5) * 0.3,
        accent: ARCADE_PALETTE.graffiti[
          Math.floor(rng() * ARCADE_PALETTE.graffiti.length)
        ],
      });
    }

    const cityGltfProps: CityGltfProp[] = [];
    const gltfPropCount = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < gltfPropCount; i++) {
      const side = rng() > 0.5 ? 1 : -1;
      const kind = CITY_PROP_KEYS[Math.floor(rng() * CITY_PROP_KEYS.length)];
      const nearFence =
        kind === 'trafficLight' || kind === 'busStopSign' || kind === 'stopSign' || kind === 'cone';
      const lateralOffset = nearFence ? 1.05 + rng() * 0.5 : 1.75 + rng() * 1.15;
      const x = kind === 'trafficLight'
        ? (HALF_WIDTH + SIDE_BARRIER_INSET) * side
        : (HALF_WIDTH + SIDE_BARRIER_INSET + lateralOffset) * side;
      const z = -1.5 - rng() * (CHUNK_LENGTH - 3);
      cityGltfProps.push({
        kind,
        side,
        x,
        z,
        rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }

    // Readable sidewalk anchors per chunk. Keep bus stop signs rare so the
    // sidewalk does not look like repeated signage every few meters.
    const busStopSide = rng() > 0.5 ? 1 : -1;
    const busStopRotY = busStopSide > 0 ? -Math.PI / 2 : Math.PI / 2;
    if (rng() > 0.35) {
      cityGltfProps.push({
        kind: 'busStopSign',
        side: busStopSide,
        x: (HALF_WIDTH + SIDE_BARRIER_INSET + 1.25) * busStopSide,
        z: -CHUNK_LENGTH * 0.28 - rng() * 2.5,
        rotY: busStopRotY,
      });
    }

    // Benches are less visually repetitive, so keep one on each side.
    for (const side of [-1, 1] as const) {
      const rotY = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      cityGltfProps.push({
        kind: 'bench',
        side,
        x: (HALF_WIDTH + SIDE_BARRIER_INSET + 1.85) * side,
        z: -CHUNK_LENGTH * 0.68 - rng() * 1.4,
        rotY,
      });
    }

    return { ties, buildings, posts, arrows, stickers, props, fencePosts, cityGltfProps };
  }, [seed]);

  return (
    <group position={[0, 0, startZ]}>
      {/* Dirt ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, centerZ]}>
        <planeGeometry args={[TRACK_WIDTH + 9.5, CHUNK_LENGTH]} />
        <meshLambertMaterial color={GROUND_COLOR} />
      </mesh>

      {/* Sidewalk strips cover the space between fence and buildings so lane
          shifts never reveal blue sky gaps beside the skyline. */}
      {([-1, 1] as const).map((side) => (
        <mesh
          key={`sidewalk-${side}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[side * (HALF_WIDTH + 2.25), 0.01, centerZ]}
        >
          <planeGeometry args={[4.25, CHUNK_LENGTH]} />
          <meshLambertMaterial color={side > 0 ? '#b9c0c9' : '#aeb7c2'} />
        </mesh>
      ))}

      {/* Painted boost arrows on the ground */}
      {decor.arrows.map((a, i) => (
        <BoostArrow key={`arrow-${i}`} x={a.x} z={a.z} />
      ))}

      {/* Wooden ties */}
      {decor.ties.map((t, i) => (
        <RoundedBox
          key={`tie-${i}`}
          args={[TRACK_WIDTH - 0.2, 0.1, 0.34, 2, 0.03]}
          position={[0, 0.05, t.z]}
        >
          <meshLambertMaterial color="#3b2615" />
        </RoundedBox>
      ))}

      {/* Silver rails (6: two per lane) */}
      {([-1, 0, 1] as const).map((laneKey) =>
        [-RAIL_OFFSET, RAIL_OFFSET].map((off, j) => {
          const x = LANE_X[laneKey.toString() as '-1' | '0' | '1'] + off;
          return (
            <RoundedBox
              key={`rail-${laneKey}-${j}`}
              args={[0.08, 0.09, CHUNK_LENGTH, 2, 0.02]}
              position={[x, 0.12, centerZ]}
            >
              <meshLambertMaterial color="#dde2ea" />
            </RoundedBox>
          );
        }),
      )}

      {/* Lightweight continuous side fence. Repeated GLB fence pieces caused
          frame hitches whenever a chunk recycled; this keeps the same visual
          barrier role without cloning dozens of GLBs every few seconds. */}
      {([-1, 1] as const).map((side) => {
        const x = side * (HALF_WIDTH + SIDE_BARRIER_INSET);
        return (
          <group key={`barrier-${side}`}>
            <RoundedBox
              args={[0.12, 0.12, CHUNK_LENGTH, 2, 0.03]}
              position={[x, 0.95, centerZ]}
            >
              <meshLambertMaterial color="#f5f7fb" />
            </RoundedBox>
            <RoundedBox
              args={[0.1, 0.1, CHUNK_LENGTH, 2, 0.03]}
              position={[x, 0.48, centerZ]}
            >
              <meshLambertMaterial color="#cbd5e1" />
            </RoundedBox>
            {decor.fencePosts
              .filter((piece) => piece.side === side)
              .map((piece, i) => (
                <RoundedBox
                  key={`fence-post-${side}-${i}`}
                  args={[0.22, 1.05, 0.16, 2, 0.04]}
                  position={[x, 0.52, piece.z]}
                >
                  <meshLambertMaterial color={i % 2 === 0 ? '#e2e8f0' : '#f8fafc'} />
                </RoundedBox>
              ))}
          </group>
        );
      })}

      {/* Street-level props (hydrants, benches, vendor stalls, etc.) */}
      {decor.props.map((p, i) => (
        <StreetProp key={`prop-${i}`} spec={p} />
      ))}

      {/* GLB city props from the downloaded city pack: traffic lights,
          billboards, signs, trees, benches, hydrants, cans, and cones. */}
      {decor.cityGltfProps.map((p, i) => (
        <CityGltfProp key={`city-gltf-prop-${i}`} spec={p} />
      ))}

      {/* Background skyline buildings (5 procedural variants) */}
      {decor.buildings.map((b, i) => (
        <Building key={`bldg-${i}`} spec={b} />
      ))}

      {/* Lamp / signal posts */}
      {decor.posts.map((p, i) => (
        <group key={`post-${i}`} position={[p.x, 0, p.z]}>
          <RoundedBox args={[0.12, 3.4, 0.12, 2, 0.04]} position={[0, 1.7, 0]}>
            <meshLambertMaterial color="#3a3f47" />
          </RoundedBox>
          <RoundedBox
            args={[0.7, 0.12, 0.12, 2, 0.04]}
            position={[p.x > 0 ? -0.35 : 0.35, 3.15, 0]}
          >
            <meshLambertMaterial color="#3a3f47" />
          </RoundedBox>
          <mesh position={[p.x > 0 ? -0.6 : 0.6, 2.95, 0]}>
            <sphereGeometry args={[0.18, 12, 10]} />
            <meshBasicMaterial color="#fff7b8" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function BoostArrow({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.03, z]} rotation={[-Math.PI / 2, 0, 0]}>
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

function CityGltfProp({ spec }: { spec: CityGltfProp }) {
  const asset = getModelAsset(spec.kind);
  if (!asset) return null;
  const rotY = spec.kind === 'trafficLight' ? spec.rotY + Math.PI / 2 : spec.rotY;

  return (
    <GLBModel
      assetModule={asset}
      fitHeight={CITY_PROP_HEIGHTS[spec.kind]}
      position={[
        spec.x,
        spec.kind === 'trafficLight' ? TRAFFIC_LIGHT_RAIL_Y : 0,
        spec.z,
      ]}
      rotation={[0, rotY, 0]}
      textureAssetModule={spec.kind === 'trafficLight' ? TRAFFIC_LIGHT_TEXTURE : undefined}
    />
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

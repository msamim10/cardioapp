import { useMemo } from 'react';
import { ARCADE_PALETTE, LANE_X } from '@/lib/constants';
import { getModelAsset } from '@/lib/modelRegistry';
import type { ObstacleSpec } from '@/lib/types';
import { GLBModel } from './models/GLBModel';
import { RoundedBox } from './RoundedBox';

type Props = {
  spec: ObstacleSpec;
};

const LANE_WIDTH = 1.55;
const TRAFFIC_BARRIER_TEXTURE = require('../../../assets/models/trafficBarrier.png');
const OVERHEAD_OBSTACLE_TEXTURE = require('../../../assets/models/overheadObstacle.png');

export function Obstacle({ spec }: Props) {
  const x = LANE_X[spec.lane.toString() as '-1' | '0' | '1'];
  const paletteIdx = useMemo(() => {
    let h = 0;
    for (let i = 0; i < spec.id.length; i++) {
      h = (h * 31 + spec.id.charCodeAt(i)) & 0xffff;
    }
    return h % ARCADE_PALETTE.trainBodies.length;
  }, [spec.id]);

  switch (spec.kind) {
    case 'barrier': {
      const barrierAsset = getModelAsset('trafficBarrier');
      if (barrierAsset) {
        return (
          <GLBModel
            assetModule={barrierAsset}
            fitWidth={1.65}
            scale={[1.1, 1.18, 1.1]}
            position={[x, 0, spec.z]}
            rotation={[0, 0, 0]}
            textureAssetModule={TRAFFIC_BARRIER_TEXTURE}
            fallback={<BarrierProp x={x} z={spec.z} />}
          />
        );
      }
      return <BarrierProp x={x} z={spec.z} />;
    }
    case 'overhead': {
      const overheadAsset = getModelAsset('overheadObstacle');
      if (overheadAsset) {
        return <DuckObstacleModel assetModule={overheadAsset} x={x} z={spec.z} />;
      }
      return <CrossingArm x={x} z={spec.z} />;
    }
    case 'trainGap': {
      // Non-rendering jump trigger used by the roof-run section. The trains
      // themselves are drawn by <TrainRoofRun />; this case just keeps the
      // wall/train default below from accidentally rendering a train here.
      return null;
    }
    case 'wall':
    default: {
      const body = ARCADE_PALETTE.trainBodies[paletteIdx];
      const roof = ARCADE_PALETTE.trainRoofs[paletteIdx];
      const trim = ARCADE_PALETTE.trainTrims[paletteIdx];
      const trainAsset = getModelAsset('train');
      if (trainAsset) {
        // GLB only. Workout screen preloads it during the countdown so the
        // first train obstacle pops in instantly.
        return (
          <GLBModel
            assetModule={trainAsset}
            fitWidth={4.4}
            scale={[1.08, 1.34, 1.08]}
            position={[x, 0, spec.z]}
            rotation={[0, Math.PI / 2, 0]}
          />
        );
      }
      return <TrainPrimitive x={x} z={spec.z} body={body} roof={roof} trim={trim} />;
    }
  }
}

function DuckObstacleModel({
  assetModule,
  x,
  z,
}: {
  assetModule: number;
  x: number;
  z: number;
}) {
  return (
    <group position={[x, 0, z]}>
      <GLBModel
        assetModule={assetModule}
        fitWidth={1.7}
        scale={[1.1, 1.4, 1.1]}
        textureAssetModule={OVERHEAD_OBSTACLE_TEXTURE}
        fallback={<CrossingArm x={0} z={0} />}
      />
    </group>
  );
}

function BarrierProp({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <RoundedBox args={[LANE_WIDTH, 1.0, 0.55, 4, 0.12]} position={[0, 0.5, 0]}>
        <meshLambertMaterial color="#fb923c" />
      </RoundedBox>
      {/* Vertical-bar hazard stripes painted on the front (more readable) */}
      {[-0.55, -0.18, 0.18, 0.55].map((sx, i) => (
        <mesh key={`stripe-${i}`} position={[sx, 0.55, 0.29]} rotation={[0, 0, Math.PI / 7]}>
          <planeGeometry args={[0.16, 0.85]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>
      ))}
      {/* Bright reflective top */}
      <RoundedBox args={[LANE_WIDTH + 0.05, 0.12, 0.58, 3, 0.04]} position={[0, 1.05, 0]}>
        <meshBasicMaterial color="#fef3c7" />
      </RoundedBox>
    </group>
  );
}

function CrossingArm({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* Posts with stripes */}
      {[-(LANE_WIDTH / 2) + 0.1, LANE_WIDTH / 2 - 0.1].map((px, i) => (
        <group key={`post-${i}`} position={[px, 0, 0]}>
          <RoundedBox args={[0.16, 2.0, 0.16, 2, 0.04]} position={[0, 1.0, 0]}>
            <meshLambertMaterial color="#facc15" />
          </RoundedBox>
          {[0.35, 0.95, 1.55].map((y, j) => (
            <mesh key={j} position={[0, y, 0.085]}>
              <planeGeometry args={[0.18, 0.22]} />
              <meshBasicMaterial color="#0f172a" />
            </mesh>
          ))}
          {/* Concrete base */}
          <RoundedBox args={[0.34, 0.16, 0.34, 2, 0.04]} position={[0, 0.08, 0]}>
            <meshLambertMaterial color="#b8babf" />
          </RoundedBox>
        </group>
      ))}
      <RoundedBox args={[LANE_WIDTH + 0.15, 0.28, 0.26, 3, 0.07]} position={[0, 1.5, 0]}>
        <meshLambertMaterial color="#fef9f5" />
      </RoundedBox>
      {[-0.55, -0.18, 0.18, 0.55].map((sx, i) => (
        <mesh key={`stripe-${i}`} position={[sx, 1.5, 0.135]} rotation={[0, 0, Math.PI / 5]}>
          <planeGeometry args={[0.24, 0.42]} />
          <meshBasicMaterial color="#dc2626" />
        </mesh>
      ))}
      {[-(LANE_WIDTH / 2) - 0.05, LANE_WIDTH / 2 + 0.05].map((lx, i) => (
        <mesh key={`lamp-${i}`} position={[lx, 1.5, 0.16]}>
          <sphereGeometry args={[0.11, 14, 12]} />
          <meshBasicMaterial color="#fca5a5" />
        </mesh>
      ))}
    </group>
  );
}

function TrainPrimitive({
  x,
  z,
  body,
  roof,
  trim,
}: {
  x: number;
  z: number;
  body: string;
  roof: string;
  trim: string;
}) {
  // A composition of ~50 primitives standing in for a stylized cartoon subway
  // car: rounded body + bullet nose, four wheels on bogies, headlight housings
  // with sphere bulbs, three door panels per side with frames + handles, four
  // windows per side, route badge, side mirrors, multi-piece roof (vents +
  // pantograph + AC unit), trim stripes, and rear lights.
  return (
    <group position={[x, 0, z]}>
      {/* === BOGIES + WHEELS === */}
      {/* Bogie housings (dark boxes under the body) */}
      {[-1.0, 1.0].map((bz, i) => (
        <RoundedBox
          key={`bogie-${i}`}
          args={[LANE_WIDTH * 0.7, 0.32, 0.7, 2, 0.06]}
          position={[0, 0.35, bz]}
        >
          <meshLambertMaterial color="#1f2937" />
        </RoundedBox>
      ))}
      {/* 4 wheels (cylinders rotated 90deg around z so axis is horizontal/x) */}
      {[
        [-LANE_WIDTH / 2 - 0.03, -1.0],
        [LANE_WIDTH / 2 + 0.03, -1.0],
        [-LANE_WIDTH / 2 - 0.03, 1.0],
        [LANE_WIDTH / 2 + 0.03, 1.0],
      ].map(([wx, wz], i) => (
        <group key={`wheel-${i}`} position={[wx, 0.32, wz]} rotation={[0, 0, Math.PI / 2]}>
          <mesh>
            <cylinderGeometry args={[0.32, 0.32, 0.18, 18]} />
            <meshLambertMaterial color="#0f172a" />
          </mesh>
          {/* Hubcap */}
          <mesh position={[0.1, 0, 0]}>
            <cylinderGeometry args={[0.18, 0.18, 0.02, 14]} />
            <meshLambertMaterial color="#9aa3b2" />
          </mesh>
        </group>
      ))}

      {/* === MAIN BODY === */}
      <RoundedBox args={[LANE_WIDTH, 2.3, 3.2, 5, 0.24]} position={[0, 1.55, 0]}>
        <meshLambertMaterial color={body} />
      </RoundedBox>
      {/* Bullet nose (slightly smaller and forward) */}
      <RoundedBox args={[LANE_WIDTH * 0.88, 2.05, 0.7, 5, 0.32]} position={[0, 1.5, 1.75]}>
        <meshLambertMaterial color={body} />
      </RoundedBox>

      {/* === ROOF === */}
      <RoundedBox args={[LANE_WIDTH + 0.12, 0.22, 3.35, 3, 0.06]} position={[0, 2.78, 0]}>
        <meshLambertMaterial color={roof} />
      </RoundedBox>
      {/* AC unit */}
      <RoundedBox args={[0.7, 0.28, 0.95, 3, 0.07]} position={[0, 3.03, 0.6]}>
        <meshLambertMaterial color={trim} />
      </RoundedBox>
      {/* Air vents */}
      {[-0.7, -0.25, 0.2].map((vz, i) => (
        <RoundedBox key={`vent-${i}`} args={[0.55, 0.1, 0.18, 2, 0.03]} position={[0, 2.95, vz - 0.5]}>
          <meshLambertMaterial color="#1f2937" />
        </RoundedBox>
      ))}

      {/* === PANTOGRAPH (electrical pickup on the roof) === */}
      <PantographAssembly />

      {/* === FRONT FACE / "FACE" === */}
      {/* Dark windshield */}
      <mesh position={[0, 1.85, 2.105]}>
        <planeGeometry args={[LANE_WIDTH * 0.72, 0.85]} />
        <meshBasicMaterial color="#0b1320" />
      </mesh>
      {/* Windshield frame */}
      <RoundedBox args={[LANE_WIDTH * 0.76, 0.95, 0.04, 3, 0.04]} position={[0, 1.85, 2.09]}>
        <meshLambertMaterial color="#1f2937" />
      </RoundedBox>
      {/* Lower bumper */}
      <RoundedBox args={[LANE_WIDTH * 0.95, 0.42, 0.18, 3, 0.06]} position={[0, 0.7, 2.1]}>
        <meshLambertMaterial color={trim} />
      </RoundedBox>
      {/* Coupler / hitch */}
      <RoundedBox args={[0.22, 0.16, 0.32, 2, 0.04]} position={[0, 0.5, 2.27]}>
        <meshLambertMaterial color="#1f2937" />
      </RoundedBox>
      {/* Big chunky headlight housings with sphere bulbs */}
      {[-0.45, 0.45].map((hx, i) => (
        <group key={`hl-${i}`} position={[hx, 1.05, 2.105]}>
          <RoundedBox args={[0.36, 0.3, 0.16, 3, 0.06]}>
            <meshLambertMaterial color="#1f2937" />
          </RoundedBox>
          <mesh position={[0, 0, 0.085]}>
            <sphereGeometry args={[0.13, 16, 12]} />
            <meshBasicMaterial color="#fff8d4" />
          </mesh>
        </group>
      ))}
      {/* Route number badge - colored circle */}
      <mesh position={[0, 2.4, 2.11]}>
        <circleGeometry args={[0.2, 18]} />
        <meshBasicMaterial color={trim} />
      </mesh>
      <mesh position={[0, 2.4, 2.115]}>
        <ringGeometry args={[0.13, 0.17, 18]} />
        <meshBasicMaterial color="#fef9f5" />
      </mesh>

      {/* === SIDE PANELS, DOORS, WINDOWS === */}
      {([-1, 1] as const).map((side) => (
        <SidePanels key={`side-${side}`} side={side} body={body} trim={trim} />
      ))}

      {/* === SIDE MIRRORS === */}
      {([-1, 1] as const).map((side) => (
        <group
          key={`mirror-${side}`}
          position={[side * (LANE_WIDTH / 2 + 0.18), 1.85, 1.6]}
        >
          <RoundedBox args={[0.22, 0.04, 0.04, 2, 0.02]} position={[side * 0.1, 0, 0]}>
            <meshLambertMaterial color="#1f2937" />
          </RoundedBox>
          <RoundedBox args={[0.14, 0.18, 0.06, 2, 0.03]} position={[side * 0.22, 0, 0]}>
            <meshLambertMaterial color={trim} />
          </RoundedBox>
        </group>
      ))}

      {/* === REAR LIGHTS === */}
      {[-0.45, 0.45].map((rx, i) => (
        <mesh key={`tail-${i}`} position={[rx, 1.05, -1.605]}>
          <boxGeometry args={[0.28, 0.18, 0.04]} />
          <meshBasicMaterial color="#fca5a5" />
        </mesh>
      ))}
    </group>
  );
}

function PantographAssembly() {
  return (
    <group position={[0, 3.1, -0.6]}>
      {/* Base */}
      <RoundedBox args={[0.4, 0.08, 0.4, 2, 0.03]} position={[0, 0, 0]}>
        <meshLambertMaterial color="#1f2937" />
      </RoundedBox>
      {/* Two angled arms forming a diamond shape */}
      {[-1, 1].map((s, i) => (
        <mesh
          key={`arm-${i}`}
          position={[s * 0.13, 0.25, 0]}
          rotation={[0, 0, s * 0.4]}
        >
          <boxGeometry args={[0.03, 0.55, 0.03]} />
          <meshLambertMaterial color="#1f2937" />
        </mesh>
      ))}
      {/* Top contact strip */}
      <RoundedBox args={[0.55, 0.05, 0.12, 2, 0.02]} position={[0, 0.55, 0]}>
        <meshLambertMaterial color="#9aa3b2" />
      </RoundedBox>
    </group>
  );
}

function SidePanels({ side, body, trim }: { side: -1 | 1; body: string; trim: string }) {
  const x = side * (LANE_WIDTH / 2 + 0.005);
  const rotY = side === 1 ? -Math.PI / 2 : Math.PI / 2;
  return (
    <group position={[x, 0, 0]} rotation={[0, rotY, 0]}>
      {/* Trim stripe along the bottom */}
      <mesh position={[0, 0.95, 0.01]}>
        <planeGeometry args={[2.95, 0.22]} />
        <meshBasicMaterial color={trim} />
      </mesh>
      {/* 3 door panels along the side with frames */}
      {[-1.0, 0, 1.0].map((dz, i) => (
        <group key={`door-${i}`} position={[dz, 1.7, 0.005]}>
          {/* Door body (slightly darker color than train body) */}
          <mesh>
            <planeGeometry args={[0.7, 1.5]} />
            <meshLambertMaterial color={body} />
          </mesh>
          {/* Door frame */}
          <mesh position={[0, 0, 0.002]}>
            <planeGeometry args={[0.76, 1.56]} />
            <meshBasicMaterial color="#0f172a" />
          </mesh>
          {/* Door body on top of frame */}
          <mesh position={[0, 0, 0.004]}>
            <planeGeometry args={[0.7, 1.5]} />
            <meshLambertMaterial color={body} />
          </mesh>
          {/* Window in upper door */}
          <mesh position={[0, 0.35, 0.006]}>
            <planeGeometry args={[0.5, 0.5]} />
            <meshBasicMaterial color="#0b1320" />
          </mesh>
          {/* Door handle */}
          <mesh position={[0.25, -0.05, 0.02]}>
            <boxGeometry args={[0.06, 0.16, 0.03]} />
            <meshLambertMaterial color="#1f2937" />
          </mesh>
        </group>
      ))}
      {/* Windows between doors (4 total) */}
      {[-1.5, -0.5, 0.5, 1.5].map((wz, i) => (
        <group key={`win-${i}`} position={[wz, 2.05, 0.008]}>
          {/* Window frame */}
          <mesh>
            <planeGeometry args={[0.42, 0.58]} />
            <meshBasicMaterial color="#0f172a" />
          </mesh>
          {/* Window glass */}
          <mesh position={[0, 0, 0.002]}>
            <planeGeometry args={[0.36, 0.52]} />
            <meshBasicMaterial color="#0b1320" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

import { useMemo, type ReactNode } from 'react';
import { ARCADE_PALETTE, LANE_X } from '@/lib/constants';
import { getCityAsset, getCityAtlas, type CityModelKey } from '@/lib/cityBuilderRegistry';
import { terrainHeight } from '@/lib/terrain';
import type { ObstacleSpec, WorkoutSceneVariant } from '@/lib/types';
import { GLBModel } from './models/GLBModel';
import { RoundedBox } from './RoundedBox';

type Props = {
  spec: ObstacleSpec;
  variant?: WorkoutSceneVariant;
};

const LANE_WIDTH = 1.55;

const CAR_WIDTH = 1.55;
const CAR_HEIGHT = 1.25;
const CAR_DEPTH = 2.4;

export function Obstacle({ spec, variant }: Props) {
  const x = LANE_X[spec.lane.toString() as '-1' | '0' | '1'];
  const hash = useMemo(() => {
    let h = 0;
    for (let i = 0; i < spec.id.length; i++) {
      h = (h * 31 + spec.id.charCodeAt(i)) & 0xffff;
    }
    return h;
  }, [spec.id]);

  let content: ReactNode;
  switch (spec.kind) {
    case 'barrier':
      content = <JumpBarrier x={x} z={spec.z} />;
      break;
    case 'overhead':
      content = <RollBarrier x={x} z={spec.z} />;
      break;
    case 'trainGap':
      // Non-rendering jump trigger used by the roof-run section. The trains
      // themselves are drawn by <TrainRoofRun />.
      return null;
    case 'wall':
    default:
      content = <CarObstacle x={x} z={spec.z} variant={hash % 4} />;
      break;
  }

  // Lift the obstacle onto the sloped terrain so it sits on the road surface.
  const y = terrainHeight(variant, spec.z);
  return y === 0 ? <>{content}</> : <group position={[0, y, 0]}>{content}</group>;
}

function CarObstacle({ x, z, variant }: { x: number; z: number; variant: number }) {
  const key: CityModelKey =
    variant === 0
      ? 'carHatchback'
      : variant === 1
        ? 'taxi'
        : variant === 2
          ? 'stationwagon'
          : 'policeCar';
  const isLongCar = key === 'stationwagon' || key === 'policeCar';
  return (
    <GLBModel
      assetModule={getCityAsset(key)}
      atlasModule={getCityAtlas()}
      fitWidth={CAR_WIDTH}
      fitHeight={isLongCar ? 1.35 : CAR_HEIGHT}
      fitDepth={isLongCar ? 2.75 : CAR_DEPTH}
      position={[x, 0, z]}
      rotation={[0, Math.PI, 0]}
      fallback={<CarFallback x={x} z={z} van={isLongCar} />}
    />
  );
}

function CarFallback({ x, z, van }: { x: number; z: number; van: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <RoundedBox args={[CAR_WIDTH, van ? 1.35 : 0.9, van ? 2.6 : 2.2, 3, 0.12]} position={[0, van ? 0.68 : 0.45, 0]}>
        <meshLambertMaterial color={van ? '#38bdf8' : '#ef4444'} />
      </RoundedBox>
      <RoundedBox args={[CAR_WIDTH * 0.72, 0.42, 0.7, 2, 0.08]} position={[0, van ? 1.25 : 0.9, -0.2]}>
        <meshLambertMaterial color="#bae6fd" />
      </RoundedBox>
      {[-0.52, 0.52].map((wx) =>
        [-0.7, 0.7].map((wz) => (
          <mesh key={`${wx}-${wz}`} position={[wx, 0.16, wz]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.18, 0.18, 0.12, 14]} />
            <meshLambertMaterial color="#111827" />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Shared toll-gate pylon: rounded concrete post with hazard-striped base. */
function BarrierPylon({ x, height }: { x: number; height: number }) {
  return (
    <group position={[x, 0, 0]}>
      {/* Concrete foot */}
      <RoundedBox args={[0.3, 0.24, 0.34, 2, 0.06]} position={[0, 0.12, 0]}>
        <meshLambertMaterial color="#9aa0a8" />
      </RoundedBox>
      {/* Post */}
      <RoundedBox args={[0.18, height, 0.2, 3, 0.06]} position={[0, height / 2 + 0.1, 0]}>
        <meshLambertMaterial color="#b9bec6" />
      </RoundedBox>
      {/* Yellow/black hazard band */}
      <mesh position={[0, 0.42, -0.105]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.18, 0.22]} />
        <meshBasicMaterial color="#f7c623" />
      </mesh>
      {/* Beacon on top */}
      <mesh position={[0, height + 0.16, 0]}>
        <sphereGeometry args={[0.07, 12, 10]} />
        <meshBasicMaterial color="#ff8a2a" />
      </mesh>
    </group>
  );
}

/** White beam with red diagonal stripes, drawn on both faces. */
function StripedBeam({ y, width }: { y: number; width: number }) {
  const stripeCount = Math.max(4, Math.round(width / 0.34));
  return (
    <group position={[0, y, 0]}>
      <RoundedBox args={[width, 0.3, 0.22, 3, 0.09]}>
        <meshLambertMaterial color={ARCADE_PALETTE.hazardWhite} />
      </RoundedBox>
      {([1, -1] as const).map((face) =>
        Array.from({ length: stripeCount }).map((_, i) => (
          <mesh
            key={`stripe-${face}-${i}`}
            position={[-width / 2 + (i + 0.5) * (width / stripeCount), 0, face * 0.115]}
            rotation={[0, face === 1 ? 0 : Math.PI, 0.55]}
          >
            <planeGeometry args={[0.17, 0.38]} />
            <meshBasicMaterial color={ARCADE_PALETTE.hazardRed} />
          </mesh>
        )),
      )}
    </group>
  );
}

/**
 * The SS "jump only" barrier: striped beam at hip height with a grey
 * lattice blocking the gap underneath (so no rolling under) - the player
 * hops over the whole thing.
 */
function JumpBarrier({ x, z }: { x: number; z: number }) {
  const width = LANE_WIDTH + 0.12;
  const postX = width / 2 + 0.06;
  const beamY = 0.82;
  return (
    <group position={[x, 0, z]}>
      <BarrierPylon x={-postX} height={beamY + 0.12} />
      <BarrierPylon x={postX} height={beamY + 0.12} />
      <StripedBeam y={beamY} width={width} />
      {/* Lattice fill below the beam: vertical bars + bottom rail */}
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh
          key={`bar-${i}`}
          position={[-width / 2 + (i + 0.5) * (width / 5), beamY / 2, 0]}
        >
          <boxGeometry args={[0.05, beamY - 0.2, 0.05]} />
          <meshLambertMaterial color={ARCADE_PALETTE.steelLight} />
        </mesh>
      ))}
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[width, 0.08, 0.08]} />
        <meshLambertMaterial color={ARCADE_PALETTE.steel} />
      </mesh>
    </group>
  );
}

/**
 * The SS "roll only" barrier: the striped beam hangs at head height with a
 * big blocked panel ABOVE it (so jumping is clearly impossible) and an open
 * gap below - the player somersaults underneath.
 */
function RollBarrier({ x, z }: { x: number; z: number }) {
  const width = LANE_WIDTH + 0.12;
  const postX = width / 2 + 0.06;
  const beamY = 1.3;
  const panelH = 1.25;
  const topY = beamY + 0.15 + panelH; // ~2.6m, far above the jump arc
  return (
    <group position={[x, 0, z]}>
      <BarrierPylon x={-postX} height={topY - 0.2} />
      <BarrierPylon x={postX} height={topY - 0.2} />
      <StripedBeam y={beamY} width={width} />
      {/* Blocked panel above the beam */}
      <RoundedBox
        args={[width, panelH, 0.14, 3, 0.05]}
        position={[0, beamY + 0.15 + panelH / 2, 0]}
      >
        <meshLambertMaterial color={ARCADE_PALETTE.steel} />
      </RoundedBox>
      {/* Down-chevrons on the panel telling the player to go LOW (front face) */}
      {[0.42, 0.78].map((dy, i) => (
        <group key={`chev-${i}`} position={[0, beamY + 0.15 + panelH - dy, -0.075]}>
          <mesh position={[-0.17, 0, 0]} rotation={[0, Math.PI, 0.6]}>
            <planeGeometry args={[0.4, 0.12]} />
            <meshBasicMaterial color="#f7c623" />
          </mesh>
          <mesh position={[0.17, 0, 0]} rotation={[0, Math.PI, -0.6]}>
            <planeGeometry args={[0.4, 0.12]} />
            <meshBasicMaterial color="#f7c623" />
          </mesh>
        </group>
      ))}
      {/* Thin edge frame for the panel */}
      <mesh position={[0, beamY + 0.15 + panelH / 2, -0.082]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width * 0.94, panelH * 0.06]} />
        <meshBasicMaterial color={ARCADE_PALETTE.steelLight} />
      </mesh>
    </group>
  );
}

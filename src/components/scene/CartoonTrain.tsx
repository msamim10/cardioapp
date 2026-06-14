import { memo } from 'react';
import { ARCADE_PALETTE } from '@/lib/constants';
import { RoundedBox } from './RoundedBox';

/**
 * Hand-built Subway Surfers-style trains. Two variants:
 *
 *  - 'metro': chunky passenger car - one strong livery color, cream roof,
 *    big black windshield, cow-catcher wedge, window band, sliding doors.
 *  - 'cargo': grey flatbed wagon carrying a bright corrugated container.
 *
 * The group origin is at GROUND level, centered on the car footprint, with
 * the nose facing +Z (toward the approaching player). `width` / `height` /
 * `length` are exact outer dimensions: the highest surface is a flat roof
 * at y = height, so roof-run trains can be walked on without the camera
 * floating or clipping.
 */

export type TrainVariant = 'metro' | 'cargo';

/**
 * Weighted livery picker: the classic red/cream car (index 0) is the hero
 * look from the reference shot, so ~60% of trains use it.
 */
export function weightedLiveryIndex(hash: number): number {
  const h = Math.abs(hash);
  if (h % 10 < 6) return 0;
  return 1 + (h % (ARCADE_PALETTE.trainLiveries.length - 1));
}

type Props = {
  position?: [number, number, number];
  width: number;
  height: number;
  length: number;
  /** Index into ARCADE_PALETTE liveries/containers. Any integer works. */
  colorIndex?: number;
  variant?: TrainVariant;
  /** True for roof-run trains: skips roof vents so the top stays flat. */
  roofClear?: boolean;
};

function CartoonTrainComponent({
  position,
  width,
  height,
  length,
  colorIndex = 0,
  variant = 'metro',
  roofClear = false,
}: Props) {
  if (variant === 'cargo') {
    return (
      <group position={position}>
        <CargoWagon width={width} height={height} length={length} colorIndex={colorIndex} />
      </group>
    );
  }
  return (
    <group position={position}>
      <MetroCar
        width={width}
        height={height}
        length={length}
        colorIndex={colorIndex}
        roofClear={roofClear}
      />
    </group>
  );
}

const WHEEL_RADIUS_RATIO = 0.085;

function MetroCar({
  width,
  height,
  length,
  colorIndex,
  roofClear,
}: {
  width: number;
  height: number;
  length: number;
  colorIndex: number;
  roofClear: boolean;
}) {
  const liveries = ARCADE_PALETTE.trainLiveries;
  const livery = liveries[((colorIndex % liveries.length) + liveries.length) % liveries.length];

  const wheelR = Math.max(0.12, height * WHEEL_RADIUS_RATIO);
  const skirtTop = wheelR * 2.1;
  const roofH = height * 0.085;
  const bodyBottom = skirtTop * 0.55;
  const bodyH = height - roofH - bodyBottom;
  const bodyCenterY = bodyBottom + bodyH / 2;
  const roofCenterY = height - roofH / 2;
  const noseLen = Math.min(0.55, length * 0.09);
  const halfL = length / 2;
  const halfW = width / 2;

  // Window band runs along the upper body; doors sit below it.
  const bandH = bodyH * 0.3;
  const bandY = bodyBottom + bodyH * 0.66;
  const stripeY = bodyBottom + bodyH * 0.18;

  const windowCount = Math.max(3, Math.round(length / 1.6));
  const windowW = (length * 0.78) / windowCount - 0.18;
  const doorZs = [-length * 0.22, length * 0.22];

  return (
    <group>
      {/* Underframe skirt */}
      <RoundedBox
        args={[width * 0.92, skirtTop, length * 0.96, 2, 0.05]}
        position={[0, skirtTop / 2, 0]}
      >
        <meshLambertMaterial color="#2b3340" />
      </RoundedBox>

      {/* Wheels (two bogies, slightly poking out of the skirt) */}
      {[-length * 0.32, length * 0.32].map((bz) =>
        ([-1, 1] as const).map((side) => (
          <mesh
            key={`wheel-${bz}-${side}`}
            position={[side * (halfW * 0.82), wheelR, bz]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[wheelR, wheelR, 0.12, 14]} />
            <meshLambertMaterial color="#181f29" />
          </mesh>
        )),
      )}

      {/* Main body */}
      <RoundedBox
        args={[width, bodyH, length, 4, Math.min(0.16, width * 0.1)]}
        position={[0, bodyCenterY, 0]}
      >
        <meshLambertMaterial color={livery.body} />
      </RoundedBox>

      {/* Cream roof slab - the flat walkable top at exactly y = height */}
      <RoundedBox
        args={[width * 0.96, roofH, length * 0.99, 3, Math.min(0.07, roofH * 0.45)]}
        position={[0, roofCenterY, 0]}
      >
        <meshLambertMaterial color={livery.roof} />
      </RoundedBox>

      {/* Low roof vents (skipped on roof-run trains so the top stays flat) */}
      {!roofClear &&
        [-length * 0.28, 0, length * 0.28].map((vz, i) => (
          <RoundedBox
            key={`vent-${i}`}
            args={[width * 0.4, roofH * 0.7, length * 0.12, 2, 0.03]}
            position={[0, height + roofH * 0.3, vz]}
          >
            <meshLambertMaterial color={livery.trim} />
          </RoundedBox>
        ))}

      {/* Nose wedge below the windshield */}
      <RoundedBox
        args={[width * 0.9, bodyH * 0.46, noseLen, 3, Math.min(0.12, noseLen * 0.4)]}
        position={[0, bodyBottom + bodyH * 0.24, halfL + noseLen / 2 - 0.06]}
      >
        <meshLambertMaterial color={livery.nose} />
      </RoundedBox>

      {/* Cow-catcher: chunky angled plow at the very front */}
      <mesh
        position={[0, skirtTop * 0.55, halfL + noseLen * 0.55]}
        rotation={[Math.PI * 0.16, 0, 0]}
      >
        <boxGeometry args={[width * 0.84, skirtTop * 1.5, 0.1]} />
        <meshLambertMaterial color={livery.trim} />
      </mesh>

      {/* Windshield (big black rounded pane) + cream frame */}
      <RoundedBox
        args={[width * 0.74, bandH * 1.45, 0.06, 3, 0.05]}
        position={[0, bandY, halfL + 0.02]}
      >
        <meshLambertMaterial color="#101826" />
      </RoundedBox>
      <RoundedBox
        args={[width * 0.82, bandH * 1.62, 0.04, 3, 0.05]}
        position={[0, bandY, halfL - 0.015]}
      >
        <meshLambertMaterial color={livery.roof} />
      </RoundedBox>

      {/* Headlights */}
      {[-width * 0.28, width * 0.28].map((hx, i) => (
        <group key={`hl-${i}`} position={[hx, bodyBottom + bodyH * 0.24, halfL + noseLen - 0.02]}>
          <mesh>
            <cylinderGeometry args={[width * 0.085, width * 0.085, 0.07, 14]} />
            <meshLambertMaterial color={livery.trim} />
          </mesh>
          <mesh position={[0, 0, 0.045]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[width * 0.062, 14]} />
            <meshBasicMaterial color="#fff6cf" />
          </mesh>
        </group>
      ))}

      {/* Route badge sitting on the windshield glass */}
      <mesh position={[0, bandY + bandH * 0.42, halfL + 0.062]}>
        <circleGeometry args={[width * 0.09, 18]} />
        <meshBasicMaterial color={livery.body} />
      </mesh>

      {/* Side detail: window band, doors, trim stripe (both sides) */}
      {([-1, 1] as const).map((side) => (
        <group
          key={`side-${side}`}
          position={[side * (halfW + 0.012), 0, 0]}
          rotation={[0, side === 1 ? Math.PI / 2 : -Math.PI / 2, 0]}
        >
          {/* Trim stripe along the lower body */}
          <mesh position={[0, stripeY, 0]}>
            <planeGeometry args={[length * 0.96, bodyH * 0.1]} />
            <meshBasicMaterial color={livery.trim} />
          </mesh>

          {/* Window band: light-blue panes in chunky white frames */}
          {Array.from({ length: windowCount }).map((_, i) => {
            const z = -length * 0.39 + (i + 0.5) * ((length * 0.78) / windowCount);
            return (
              <group key={`win-${i}`} position={[z, bandY, 0]}>
                <mesh position={[0, 0, 0.004]}>
                  <planeGeometry args={[windowW + 0.12, bandH + 0.12]} />
                  <meshBasicMaterial color={ARCADE_PALETTE.windowFrame} />
                </mesh>
                <mesh position={[0, 0, 0.008]}>
                  <planeGeometry args={[windowW, bandH]} />
                  <meshBasicMaterial color={ARCADE_PALETTE.windowGlass} />
                </mesh>
              </group>
            );
          })}

          {/* Sliding doors */}
          {doorZs.map((dz, i) => (
            <group key={`door-${i}`} position={[dz, 0, 0.012]}>
              <mesh position={[0, bodyBottom + bodyH * 0.42, 0]}>
                <planeGeometry args={[width * 0.52, bodyH * 0.8]} />
                <meshLambertMaterial color={livery.nose} />
              </mesh>
              {/* Door split line */}
              <mesh position={[0, bodyBottom + bodyH * 0.42, 0.004]}>
                <planeGeometry args={[0.035, bodyH * 0.8]} />
                <meshBasicMaterial color={livery.trim} />
              </mesh>
              {/* Door window (framed like the band windows) */}
              <mesh position={[0, bandY, 0.004]}>
                <planeGeometry args={[width * 0.46, bandH * 0.95]} />
                <meshBasicMaterial color={ARCADE_PALETTE.windowFrame} />
              </mesh>
              <mesh position={[0, bandY, 0.008]}>
                <planeGeometry args={[width * 0.38, bandH * 0.8]} />
                <meshBasicMaterial color={ARCADE_PALETTE.windowGlass} />
              </mesh>
            </group>
          ))}
        </group>
      ))}

      {/* Tail lights */}
      {[-width * 0.28, width * 0.28].map((rx, i) => (
        <mesh key={`tail-${i}`} position={[rx, bodyBottom + bodyH * 0.22, -halfL - 0.02]}>
          <boxGeometry args={[width * 0.12, bodyH * 0.07, 0.05]} />
          <meshBasicMaterial color="#ff6b6b" />
        </mesh>
      ))}
    </group>
  );
}

function CargoWagon({
  width,
  height,
  length,
  colorIndex,
}: {
  width: number;
  height: number;
  length: number;
  colorIndex: number;
}) {
  const hulls = ARCADE_PALETTE.cargoHulls;
  const containers = ARCADE_PALETTE.containers;
  const hull = hulls[((colorIndex % hulls.length) + hulls.length) % hulls.length];
  const box = containers[((colorIndex % containers.length) + containers.length) % containers.length];

  const wheelR = Math.max(0.12, height * WHEEL_RADIUS_RATIO);
  const bedH = height * 0.22;
  const bedTop = wheelR * 1.3 + bedH;
  const boxH = height - bedTop;
  const halfW = width / 2;

  return (
    <group>
      {/* Flatbed hull */}
      <RoundedBox
        args={[width, bedH, length, 3, 0.06]}
        position={[0, wheelR * 1.3 + bedH / 2, 0]}
      >
        <meshLambertMaterial color={hull} />
      </RoundedBox>

      {/* Wheels */}
      {[-length * 0.34, length * 0.34].map((bz) =>
        ([-1, 1] as const).map((side) => (
          <mesh
            key={`cwheel-${bz}-${side}`}
            position={[side * (halfW * 0.8), wheelR, bz]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[wheelR, wheelR, 0.12, 14]} />
            <meshLambertMaterial color="#181f29" />
          </mesh>
        )),
      )}

      {/* Container - flat top at exactly y = height for roof runs */}
      <RoundedBox
        args={[width * 0.94, boxH, length * 0.94, 3, 0.06]}
        position={[0, bedTop + boxH / 2, 0]}
      >
        <meshLambertMaterial color={box} />
      </RoundedBox>

      {/* Corrugation ridges along both sides */}
      {([-1, 1] as const).map((side) => (
        <group
          key={`ridge-${side}`}
          position={[side * (halfW * 0.94 + 0.01), bedTop + boxH / 2, 0]}
          rotation={[0, side === 1 ? Math.PI / 2 : -Math.PI / 2, 0]}
        >
          {[-0.3, 0, 0.3].map((t, i) => (
            <mesh key={i} position={[t * length, 0, 0]}>
              <planeGeometry args={[0.1, boxH * 0.86]} />
              <meshBasicMaterial color="#1f2937" transparent opacity={0.22} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Container end doors with locking bars */}
      <group position={[0, bedTop + boxH / 2, length * 0.47 + 0.012]}>
        {[-width * 0.18, width * 0.18].map((bx, i) => (
          <mesh key={`bar-${i}`} position={[bx, 0, 0]}>
            <planeGeometry args={[0.06, boxH * 0.88]} />
            <meshBasicMaterial color="#1f2937" />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export const CartoonTrain = memo(CartoonTrainComponent);

/**
 * Simple procedural ladder: two vertical rails + evenly-spaced rungs.
 *
 * Built in its NATURAL orientation (rails along +Y, rungs along ±X, no
 * lean) with the BASE sitting at local origin (0, 0, 0). So the caller can
 * apply any X rotation to tilt the ladder, and the base stays put while the
 * top swings into place. The wrapper group's `position` is the world
 * location of that base.
 *
 * Dimensions are tuned for the train roof run: length matches
 * LADDER_LENGTH (≈ 2.05m), which at the ~0.73 rad lean used by
 * <TrainRoofRun> reaches the 1.53m train roof height (cos(0.73)·2.05).
 */

const LADDER_LENGTH = 2.05;
const LADDER_WIDTH = 0.5; // distance between rail centres
const RAIL_THICKNESS = 0.06;
const RUNG_THICKNESS = 0.045;
const RUNG_COUNT = 6;

// Bright "safety yellow" rails with a darker rung so the ladder reads
// against the colourful trains. Flat / unlit (MeshBasicMaterial) keeps it
// consistent with the other procedural scene props (coins, clouds, plane).
const RAIL_COLOR = '#facc15';
const RUNG_COLOR = '#a16207';

type Props = {
  position?: [number, number, number];
  rotation?: [number, number, number];
};

export function Ladder({ position, rotation }: Props) {
  const halfWidth = LADDER_WIDTH / 2;
  // Rung length covers the OUTER edges of both rails so it doesn't look
  // like the rungs float in between gaps.
  const rungLength = LADDER_WIDTH + RAIL_THICKNESS;
  const rungSpacing = LADDER_LENGTH / (RUNG_COUNT + 1);

  return (
    <group position={position} rotation={rotation}>
      {/* Left rail */}
      <mesh position={[-halfWidth, LADDER_LENGTH / 2, 0]}>
        <boxGeometry args={[RAIL_THICKNESS, LADDER_LENGTH, RAIL_THICKNESS]} />
        <meshBasicMaterial color={RAIL_COLOR} />
      </mesh>

      {/* Right rail */}
      <mesh position={[halfWidth, LADDER_LENGTH / 2, 0]}>
        <boxGeometry args={[RAIL_THICKNESS, LADDER_LENGTH, RAIL_THICKNESS]} />
        <meshBasicMaterial color={RAIL_COLOR} />
      </mesh>

      {/* Rungs (evenly spaced, neither at base nor at top) */}
      {Array.from({ length: RUNG_COUNT }, (_, i) => {
        const y = rungSpacing * (i + 1);
        return (
          <mesh key={i} position={[0, y, 0]}>
            <boxGeometry args={[rungLength, RUNG_THICKNESS, RUNG_THICKNESS]} />
            <meshBasicMaterial color={RUNG_COLOR} />
          </mesh>
        );
      })}
    </group>
  );
}

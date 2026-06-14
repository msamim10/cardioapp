/**
 * Renders the trains and ladders that make up each roof-run section.
 *
 * Only chunks whose roofRun role is set produce geometry here; everything
 * else (ground obstacles, props, skyline, etc.) is handled by the existing
 * scene components and is untouched by this file.
 */
import { CHUNK_LENGTH, LANE_X } from '@/lib/constants';
import {
  LADDER_ENTRY_OFFSET,
  LADDER_ENTRY_X_TILT,
  LADDER_EXIT_OFFSET,
  LADDER_EXIT_X_TILT,
  ROOF_TRAIN_OFFSETS,
  TRAIN_HEIGHT,
  TRAIN_LENGTH,
  TRAIN_WIDTH,
} from '@/lib/roofRun';
import type { ChunkSpec, Lane } from '@/lib/types';
import { CartoonTrain, weightedLiveryIndex } from './CartoonTrain';
import { Ladder } from './Ladder';

type Props = {
  chunks: ChunkSpec[];
};

export function TrainRoofRun({ chunks }: Props) {
  return (
    <group>
      {chunks.map((chunk) => {
        if (!chunk.roofRun) return null;
        return <RoofRunChunk key={chunk.id} chunk={chunk} />;
      })}
    </group>
  );
}

function laneX(lane: Lane): number {
  return LANE_X[lane.toString() as '-1' | '0' | '1'];
}

function RoofRunChunk({ chunk }: { chunk: ChunkSpec }) {
  const { role, lane } = chunk.roofRun!;
  const trainOffsets = ROOF_TRAIN_OFFSETS[role];
  // Trains shift laterally so each chunk's train group can sit in its own
  // lane (this is what makes the 'lane' variant a sideways-jump section).
  // The ladders stay in lane 0 because entry/exit are always lane 0.
  const trainX = laneX(lane);
  // Stable per-chunk color so a consist keeps its livery while recycling.
  const chunkIndex = Math.abs(Math.round(chunk.startZ / CHUNK_LENGTH));

  return (
    <group position={[0, 0, chunk.startZ]}>
      {trainOffsets.map((zOffset, i) => (
        <CartoonTrain
          key={`roof-train-${i}`}
          position={[trainX, 0, zOffset]}
          width={TRAIN_WIDTH}
          height={TRAIN_HEIGHT}
          length={TRAIN_LENGTH}
          colorIndex={weightedLiveryIndex(chunkIndex * 3 + i)}
          // Lead car is a metro; the rest of the consist mixes in cargo
          // wagons so the roof run reads like a real freight line.
          variant={i === 0 ? 'metro' : (chunkIndex + i) % 2 === 0 ? 'cargo' : 'metro'}
          roofClear
        />
      ))}

      {/*
        Procedural <Ladder /> is built upright with its base at local
        origin, so position[z] is where the base sits on the ground; the X
        rotation pivots the top around that base to lean it against the
        train edge.
      */}
      {role === 'entry' && (
        <Ladder
          rotation={[LADDER_ENTRY_X_TILT, 0, 0]}
          position={[0, 0, LADDER_ENTRY_OFFSET]}
        />
      )}

      {role === 'exit' && (
        <Ladder
          rotation={[LADDER_EXIT_X_TILT, 0, 0]}
          position={[0, 0, LADDER_EXIT_OFFSET]}
        />
      )}
    </group>
  );
}

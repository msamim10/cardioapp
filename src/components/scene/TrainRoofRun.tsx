/**
 * Renders the trains and ladders that make up each roof-run section.
 *
 * Only chunks whose roofRun role is set produce geometry here; everything
 * else (ground obstacles, props, skyline, etc.) is handled by the existing
 * scene components and is untouched by this file.
 */
import { LANE_X } from '@/lib/constants';
import { getModelAsset } from '@/lib/modelRegistry';
import {
  LADDER_ENTRY_OFFSET,
  LADDER_ENTRY_X_TILT,
  LADDER_EXIT_OFFSET,
  LADDER_EXIT_X_TILT,
  ROOF_TRAIN_OFFSETS,
  ROOF_TRAIN_SCALE,
  TRAIN_FIT_WIDTH,
} from '@/lib/roofRun';
import type { ChunkSpec, Lane } from '@/lib/types';
import { Ladder } from './Ladder';
import { GLBModel } from './models/GLBModel';

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
  const trainAsset = getModelAsset('train');
  const trainOffsets = ROOF_TRAIN_OFFSETS[role];
  // Trains shift laterally so each chunk's train group can sit in its own
  // lane (this is what makes the 'lane' variant a sideways-jump section).
  // The ladders stay in lane 0 because entry/exit are always lane 0.
  const trainX = laneX(lane);

  return (
    <group position={[0, 0, chunk.startZ]}>
      {trainAsset &&
        trainOffsets.map((zOffset, i) => (
          <GLBModel
            key={`roof-train-${i}`}
            assetModule={trainAsset}
            fitWidth={TRAIN_FIT_WIDTH}
            scale={ROOF_TRAIN_SCALE}
            position={[trainX, 0, zOffset]}
            rotation={[0, Math.PI / 2, 0]}
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

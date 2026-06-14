import type { ChunkSpec, WorkoutSceneVariant } from '@/lib/types';
import { Obstacle } from './Obstacle';

type Props = {
  chunks: ChunkSpec[];
  variant?: WorkoutSceneVariant;
};

export function ObstaclesField({ chunks, variant }: Props) {
  return (
    <group>
      {chunks.map((chunk, chunkIndex) =>
        chunk.obstacles.map((spec, obstacleIndex) => (
          <Obstacle
            key={`obstacle-pool-${chunkIndex}-${obstacleIndex}`}
            spec={spec}
            variant={variant}
          />
        )),
      )}
    </group>
  );
}

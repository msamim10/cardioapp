import type { ChunkSpec } from '@/lib/types';
import { Obstacle } from './Obstacle';

type Props = {
  chunks: ChunkSpec[];
};

export function ObstaclesField({ chunks }: Props) {
  return (
    <group>
      {chunks.map((chunk, chunkIndex) =>
        chunk.obstacles.map((spec, obstacleIndex) => (
          <Obstacle
            key={`obstacle-pool-${chunkIndex}-${obstacleIndex}`}
            spec={spec}
          />
        )),
      )}
    </group>
  );
}

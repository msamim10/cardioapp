import type { ChunkSpec, WorkoutSceneVariant } from '@/lib/types';
import { EnvironmentChunk } from './EnvironmentChunk';

type Props = {
  chunks: ChunkSpec[];
  variant?: WorkoutSceneVariant;
};

export function Track({ chunks, variant = 'city-builder' }: Props) {
  return (
    <group>
      {chunks.map((chunk, index) => (
        <EnvironmentChunk
          key={`visual-chunk-${index}`}
          variant={variant}
          startZ={chunk.startZ}
          seed={index + 1}
        />
      ))}
    </group>
  );
}

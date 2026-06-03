import type { ChunkSpec } from '@/lib/types';
import { EnvironmentChunk } from './EnvironmentChunk';

type Props = {
  chunks: ChunkSpec[];
};

export function Track({ chunks }: Props) {
  return (
    <group>
      {chunks.map((chunk, index) => (
        <EnvironmentChunk
          key={`visual-chunk-${index}`}
          startZ={chunk.startZ}
          seed={index + 1}
        />
      ))}
    </group>
  );
}

import { useFrame, useThree } from '@react-three/fiber/native';
import { startTransition, useRef } from 'react';
import type { ChunkSpec } from '@/lib/types';
import { CAMERA_FORWARD_SPEED } from '@/lib/constants';
import { recycleFarthestBehind } from './chunkManager';

type Props = {
  chunks: ChunkSpec[];
  onChunksChange: (chunks: ChunkSpec[]) => void;
  spawnObstacles: (startZ: number, seed: number) => ChunkSpec['obstacles'];
  paused?: boolean;
};

/**
 * Headless r3f component that:
 *  - Advances the camera forward (negative z) each frame
 *  - Recycles chunks that have fallen behind the camera
 *  - Caps delta to avoid huge jumps after pauses / hiccups
 */
export function ForwardRunner({ chunks, onChunksChange, spawnObstacles, paused }: Props) {
  const { camera } = useThree();
  const chunksRef = useRef(chunks);
  const pendingUpdateRef = useRef<ChunkSpec[] | null>(null);
  chunksRef.current = chunks;

  useFrame((_, dt) => {
    if (paused) return;
    const clampedDt = Math.min(dt, 0.05);
    camera.position.z -= CAMERA_FORWARD_SPEED * clampedDt;

    const result = recycleFarthestBehind(
      chunksRef.current,
      camera.position.z,
      spawnObstacles,
    );
    if (result.recycled) {
      chunksRef.current = result.chunks;
      pendingUpdateRef.current = result.chunks;
      requestAnimationFrame(() => {
        const pending = pendingUpdateRef.current;
        if (!pending) return;
        pendingUpdateRef.current = null;
        startTransition(() => {
          onChunksChange(pending);
        });
      });
    }
  });

  return null;
}

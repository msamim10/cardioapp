import { useFrame } from '@react-three/fiber/native';
import { startTransition, useRef, type MutableRefObject } from 'react';
import type * as THREE from 'three';
import type { ChunkSpec } from '@/lib/types';
import { CAMERA_FORWARD_SPEED } from '@/lib/constants';
import { recycleFarthestBehind } from './chunkManager';

type Props = {
  runnerRef: MutableRefObject<THREE.Group | null>;
  chunks: ChunkSpec[];
  onChunksChange: (chunks: ChunkSpec[]) => void;
  spawnObstacles: (startZ: number, seed: number) => ChunkSpec['obstacles'];
  paused?: boolean;
};

/**
 * Headless r3f component that:
 *  - Advances the runner forward (negative z) each frame
 *  - Recycles chunks that have fallen behind the runner
 *  - Caps delta to avoid huge jumps after pauses / hiccups
 */
export function ForwardRunner({ runnerRef, chunks, onChunksChange, spawnObstacles, paused }: Props) {
  const chunksRef = useRef(chunks);
  const pendingUpdateRef = useRef<ChunkSpec[] | null>(null);
  chunksRef.current = chunks;

  useFrame((_, dt) => {
    if (paused) return;
    const runner = runnerRef.current;
    if (!runner) return;
    const clampedDt = Math.min(dt, 0.05);
    runner.position.z -= CAMERA_FORWARD_SPEED * clampedDt;

    const result = recycleFarthestBehind(
      chunksRef.current,
      runner.position.z,
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

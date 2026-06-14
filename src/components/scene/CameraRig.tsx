import { useFrame, useThree } from '@react-three/fiber/native';
import { useRef, type MutableRefObject } from 'react';
import type * as THREE from 'three';
import { CAMERA_RIG } from '@/lib/constants';

type Props = {
  runnerRef: MutableRefObject<THREE.Group | null>;
};

/**
 * Subway Surfers-style chase camera: sits high above and behind the
 * runner, pitched down at the track. Lateral and vertical follow are
 * partial/damped so lane changes and jumps read clearly on the character
 * without the whole world whipping around.
 *
 * Mounted LAST in the scene so its useFrame runs after ForwardRunner and
 * AutoRunner have moved the runner this frame.
 */
export function CameraRig({ runnerRef }: Props) {
  const { camera } = useThree();
  const smoothedYRef = useRef<number | null>(null);

  useFrame((_, dt) => {
    const runner = runnerRef.current;
    if (!runner) return;

    const targetY = runner.position.y * CAMERA_RIG.yFollow + CAMERA_RIG.height;
    if (smoothedYRef.current === null) {
      smoothedYRef.current = targetY;
    } else {
      const k = 1 - Math.exp(-CAMERA_RIG.ySmoothing * Math.min(dt, 0.05));
      smoothedYRef.current += (targetY - smoothedYRef.current) * k;
    }

    camera.position.set(
      runner.position.x * CAMERA_RIG.lateralFollow,
      smoothedYRef.current,
      runner.position.z + CAMERA_RIG.back,
    );
    camera.lookAt(
      runner.position.x * 0.8,
      runner.position.y * CAMERA_RIG.yFollow + CAMERA_RIG.lookHeight,
      runner.position.z - CAMERA_RIG.lookAhead,
    );
  });

  return null;
}

import { useMemo, type ReactNode } from 'react';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

type Props = {
  args: [width: number, height: number, depth: number, segments?: number, radius?: number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  children?: ReactNode;
};

/**
 * Renders a mesh with three.js's RoundedBoxGeometry. Used to give all our
 * subway-surfers props (trains, buildings, barriers, posts) that soft
 * cartoon edge.
 */
export function RoundedBox({ args, position, rotation, children }: Props) {
  const [w, h, d, seg = 4, r = 0.08] = args;
  const geom = useMemo(() => new RoundedBoxGeometry(w, h, d, seg, r), [w, h, d, seg, r]);
  return (
    <mesh position={position} rotation={rotation} geometry={geom}>
      {children}
    </mesh>
  );
}

import { useMemo } from 'react';
import { ARCADE_PALETTE } from '@/lib/constants';

type Props = {
  width: number;
  height: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  seed: number;
};

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A painted graffiti / poster panel built out of overlapping bright colored
 * rectangles + a couple of vertical "tag letter" bars. Procedurally seeded
 * so each chunk's graffiti is stable.
 */
export function Graffiti({ width, height, position, rotation, seed }: Props) {
  const blocks = useMemo(() => {
    const rng = mulberry32(seed >>> 0 || 1);
    const items: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      z: number;
      rot: number;
    }> = [];

    // Backdrop block (large, dark / muted)
    items.push({
      x: 0,
      y: 0,
      w: width * 0.92,
      h: height * 0.92,
      color: '#1c1f24',
      z: 0,
      rot: 0,
    });

    // 2 big bright graffiti splotches
    for (let i = 0; i < 2; i++) {
      const w = width * (0.45 + rng() * 0.3);
      const h = height * (0.4 + rng() * 0.4);
      items.push({
        x: (rng() - 0.5) * width * 0.45,
        y: (rng() - 0.5) * height * 0.3,
        w,
        h,
        color: ARCADE_PALETTE.graffiti[
          Math.floor(rng() * ARCADE_PALETTE.graffiti.length)
        ],
        z: 0.01 + i * 0.005,
        rot: (rng() - 0.5) * 0.25,
      });
    }

    // 4-5 "tag letter" vertical bars in alternating bright colors
    const letterCount = 4 + Math.floor(rng() * 2);
    const letterW = (width * 0.7) / letterCount;
    for (let i = 0; i < letterCount; i++) {
      const x = -width * 0.35 + i * letterW + letterW / 2;
      items.push({
        x,
        y: height * 0.05,
        w: letterW * 0.55,
        h: height * 0.55,
        color: ARCADE_PALETTE.graffiti[
          (Math.floor(rng() * ARCADE_PALETTE.graffiti.length) + i) %
            ARCADE_PALETTE.graffiti.length
        ],
        z: 0.025,
        rot: (rng() - 0.5) * 0.08,
      });
    }

    // A few smaller dot/sticker accents
    for (let i = 0; i < 3; i++) {
      const s = 0.1 + rng() * 0.18;
      items.push({
        x: (rng() - 0.5) * width * 0.7,
        y: (rng() - 0.5) * height * 0.7,
        w: s,
        h: s,
        color: ARCADE_PALETTE.graffiti[
          Math.floor(rng() * ARCADE_PALETTE.graffiti.length)
        ],
        z: 0.04,
        rot: rng() * Math.PI,
      });
    }

    return items;
  }, [seed, width, height]);

  return (
    <group position={position} rotation={rotation}>
      {blocks.map((b, i) => (
        <mesh key={i} position={[b.x, b.y, b.z]} rotation={[0, 0, b.rot]}>
          <planeGeometry args={[b.w, b.h]} />
          <meshBasicMaterial color={b.color} />
        </mesh>
      ))}
    </group>
  );
}

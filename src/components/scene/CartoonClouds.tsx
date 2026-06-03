import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
import * as THREE from 'three';

type Cloud = {
  key: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  tint: string;
  opacity: number;
  puffScale?: number;
};

const CLOUDS: Cloud[] = [
  // Side-of-sky clouds (existing): hug the building line on each side.
  { key: 'cloud-1', x: -7.4, y: 8.8, z: -14, scale: 1.05, tint: '#fff7ed', opacity: 0.64 },
  { key: 'cloud-2', x: 7.2, y: 10.3, z: -24, scale: 0.9, tint: '#eff6ff', opacity: 0.58 },
  { key: 'cloud-3', x: -8.8, y: 11.1, z: -38, scale: 1.35, tint: '#ffffff', opacity: 0.62 },
  { key: 'cloud-4', x: 8.4, y: 9.4, z: -52, scale: 1.0, tint: '#fefce8', opacity: 0.58 },
  { key: 'cloud-5', x: -6.8, y: 12.4, z: -68, scale: 1.42, tint: '#f8fafc', opacity: 0.6 },
  { key: 'cloud-6', x: 7.7, y: 11.4, z: -84, scale: 1.15, tint: '#fff7ed', opacity: 0.55 },
  { key: 'cloud-7', x: -10.2, y: 9.9, z: -102, scale: 1.2, tint: '#ffffff', opacity: 0.5 },
  { key: 'cloud-8', x: 10.0, y: 12.2, z: -112, scale: 1.4, tint: '#eff6ff', opacity: 0.48 },
  // Middle-of-sky clouds (new): centred between the two building rows,
  // and floating a bit higher (y ≈ 13–15) so they sit cleanly above the
  // runway and the side cloud band rather than overlapping the props.
  { key: 'cloud-mid-1', x: -2.6, y: 13.6, z: -20, scale: 1.1, tint: '#ffffff', opacity: 0.56 },
  { key: 'cloud-mid-2', x: 2.9, y: 14.4, z: -34, scale: 1.28, tint: '#f8fafc', opacity: 0.6 },
  { key: 'cloud-mid-3', x: -1.4, y: 13.0, z: -46, scale: 0.95, tint: '#fff7ed', opacity: 0.52 },
  { key: 'cloud-mid-4', x: 3.2, y: 13.8, z: -60, scale: 1.32, tint: '#eff6ff', opacity: 0.55 },
  { key: 'cloud-mid-5', x: -3.0, y: 14.9, z: -76, scale: 1.45, tint: '#ffffff', opacity: 0.5 },
  { key: 'cloud-mid-6', x: 1.6, y: 13.4, z: -96, scale: 1.18, tint: '#fefce8', opacity: 0.5 },
];

type Flock = {
  key: string;
  x: number;
  y: number;
  z: number;
  speed: number;
  scale: number;
  phase: number;
};

const BIRD_FLOCKS: Flock[] = [
  { key: 'birds-1', x: -10, y: 8.3, z: -22, speed: 0.9, scale: 0.85, phase: 0 },
  { key: 'birds-2', x: 9, y: 10.1, z: -56, speed: -0.72, scale: 0.72, phase: 1.7 },
  { key: 'birds-3', x: -8, y: 9.1, z: -90, speed: 0.78, scale: 0.78, phase: 3.1 },
  { key: 'birds-4', x: 10, y: 8.8, z: -118, speed: -0.86, scale: 0.8, phase: 4.2 },
];

export function CartoonClouds() {
  const { camera } = useThree();
  const rootRef = useRef<THREE.Group | null>(null);

  useFrame(() => {
    const root = rootRef.current;
    if (!root) return;
    // Lock the sky layer to the camera (skybox-style). The clouds and
    // birds then read as infinitely far away: they don't slide around
    // when the player jumps, ducks, or changes lanes, and they never
    // fall behind during long runs.
    root.position.x = camera.position.x;
    root.position.y = camera.position.y;
    root.position.z = camera.position.z;
  });

  return (
    <group ref={rootRef}>
      {CLOUDS.map((cloud) => (
        <CloudCluster key={cloud.key} cloud={cloud} />
      ))}
      {BIRD_FLOCKS.map((flock) => (
        <BirdFlock key={flock.key} flock={flock} />
      ))}
    </group>
  );
}

function CloudCluster({ cloud }: { cloud: Cloud }) {
  const materialProps = useMemo(
    () => ({
      color: cloud.tint,
      transparent: true,
      opacity: cloud.opacity,
      depthWrite: false,
    }),
    [cloud.opacity, cloud.tint],
  );

  return (
    <group
      position={[cloud.x, cloud.y, cloud.z]}
      scale={[cloud.scale, cloud.scale, cloud.scale]}
    >
      <mesh position={[-1.15, -0.08, 0]} scale={[1.35, 0.58, 0.52]}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshBasicMaterial {...materialProps} />
      </mesh>
      <mesh position={[-0.32, 0.32, 0.02]} scale={[1.45, 0.86, 0.62]}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshBasicMaterial {...materialProps} />
      </mesh>
      <mesh position={[0.78, 0.18, 0]} scale={[1.5, 0.74, 0.58]}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshBasicMaterial {...materialProps} />
      </mesh>
      <mesh position={[1.55, -0.06, 0]} scale={[1.05, 0.55, 0.48]}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshBasicMaterial {...materialProps} />
      </mesh>
      <mesh position={[0.18, -0.24, 0.02]} scale={[2.15, 0.5, 0.48]}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshBasicMaterial {...materialProps} />
      </mesh>
      {/* Soft blue underside shadow for the Subway Surfers cartoon read. */}
      <mesh position={[0.1, -0.45, 0.03]} scale={[1.9, 0.18, 0.38]}>
        <sphereGeometry args={[1, 16, 8]} />
        <meshBasicMaterial
          color="#bfdbfe"
          transparent
          opacity={cloud.opacity * 0.45}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function BirdFlock({ flock }: { flock: Flock }) {
  const ref = useRef<THREE.Group | null>(null);

  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime + flock.phase;
    const loopX = ((t * flock.speed * 3.2 + 12) % 24) - 12;
    g.position.x = loopX;
    g.position.y = flock.y + Math.sin(t * 1.7) * 0.15;
  });

  return (
    <group
      ref={ref}
      position={[flock.x, flock.y, flock.z]}
      scale={[flock.scale, flock.scale, flock.scale]}
      rotation={[0, flock.speed < 0 ? Math.PI : 0, 0]}
    >
      {[
        [-0.55, 0.12, 0],
        [0.2, 0, 0],
        [0.95, 0.18, 0],
      ].map(([x, y, z], i) => (
        <Bird key={i} position={[x, y, z]} wingPhase={i * 0.8 + flock.phase} />
      ))}
    </group>
  );
}

function Bird({
  position,
  wingPhase,
}: {
  position: [number, number, number];
  wingPhase: number;
}) {
  const leftWing = useRef<THREE.Mesh | null>(null);
  const rightWing = useRef<THREE.Mesh | null>(null);

  useFrame((state) => {
    const flap = Math.sin(state.clock.elapsedTime * 7 + wingPhase) * 0.22;
    if (leftWing.current) leftWing.current.rotation.z = 0.55 + flap;
    if (rightWing.current) rightWing.current.rotation.z = -0.55 - flap;
  });

  return (
    <group position={position} scale={[0.42, 0.42, 0.42]}>
      <mesh ref={leftWing} position={[-0.18, 0, 0]}>
        <boxGeometry args={[0.48, 0.055, 0.035]} />
        <meshBasicMaterial color="#1e293b" transparent opacity={0.72} depthWrite={false} />
      </mesh>
      <mesh ref={rightWing} position={[0.18, 0, 0]}>
        <boxGeometry args={[0.48, 0.055, 0.035]} />
        <meshBasicMaterial color="#1e293b" transparent opacity={0.72} depthWrite={false} />
      </mesh>
    </group>
  );
}

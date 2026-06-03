/**
 * A small procedural airplane that loops continuously across the sky high
 * above the runner. The plane lives in a "sky layer" group that tracks the
 * camera (same pattern as CartoonClouds) so it never falls behind the
 * player on long workouts.
 *
 * Travels left -> right across the visible sky every PERIOD seconds with a
 * gentle vertical wobble and a short contrail. All materials disable fog
 * so the plane reads as a crisp silhouette against the blue sky regardless
 * of distance.
 */
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
import * as THREE from 'three';

const PERIOD_SEC = 32;
const SKY_Y = 24;
const SKY_Z = -65;
// Sweep is wider than the visible horizontal range at SKY_Z so the wrap
// from end-of-loop back to start happens fully off-screen.
const SPAN_X = 40;
// Half-height of the vertical arc the plane traces during each crossing.
// The plane sits ~0.35 * ARC_AMPLITUDE below SKY_Y at the ends of the
// loop and climbs to ~0.65 * ARC_AMPLITUDE above SKY_Y at the peak.
const ARC_AMPLITUDE = 5.5;

export function AirplaneFlyby() {
  const { camera } = useThree();
  const rootRef = useRef<THREE.Group | null>(null);
  const planeRef = useRef<THREE.Group | null>(null);

  useFrame((state) => {
    const root = rootRef.current;
    if (root) {
      // Lock the airplane's sky layer to the camera (skybox-style) so the
      // plane reads as far away: it doesn't slide around when the player
      // jumps / ducks / changes lanes, and it never falls behind the
      // camera during long runs. The plane's own X/Y animation happens
      // inside this locked frame.
      root.position.x = camera.position.x;
      root.position.y = camera.position.y;
      root.position.z = camera.position.z;
    }
    const plane = planeRef.current;
    if (plane) {
      const t = state.clock.elapsedTime;
      const phase = (((t % PERIOD_SEC) + PERIOD_SEC) % PERIOD_SEC) / PERIOD_SEC;
      // Horizontal sweep: still left -> right across the visible sky.
      plane.position.x = -SPAN_X + phase * SPAN_X * 2;
      // Vertical arc: the plane climbs to peak altitude at the centre of
      // its run and gently descends on the way out, plus a small bob so
      // it feels airborne rather than rail-bound.
      const arc = Math.sin(phase * Math.PI) * ARC_AMPLITUDE;
      const wobble = Math.sin(t * 1.4) * 0.4;
      plane.position.y = SKY_Y - ARC_AMPLITUDE * 0.35 + arc + wobble;
      // Pitch (nose up/down) tracks the climb rate so the plane's nose
      // actually points toward where it's heading: up while climbing,
      // level at the peak, down while descending.
      plane.rotation.z = Math.cos(phase * Math.PI) * 0.22;
      // Slight bank toward the camera so the plane reads as 3D, not a flat
      // sticker, when it crosses the centre of the frame.
      plane.rotation.x = 0.08;
    }
  });

  return (
    <group ref={rootRef}>
      <group ref={planeRef} position={[-SPAN_X, SKY_Y, SKY_Z]}>
        <Airplane />
      </group>
    </group>
  );
}

function Airplane() {
  // Built nose-forward along +X so flying left -> right needs no extra
  // rotation. Y is up, Z is wing span.
  return (
    <group>
      {/* Fuselage (cylinder rotated to lie along X) */}
      <mesh rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.32, 0.26, 4.2, 14]} />
        <meshBasicMaterial color="#fafafa" fog={false} />
      </mesh>

      {/* Nose cone at +X */}
      <mesh position={[2.3, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.26, 0.6, 14]} />
        <meshBasicMaterial color="#cbd5e1" fog={false} />
      </mesh>

      {/* Tail cap at -X */}
      <mesh position={[-2.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.32, 0.35, 14]} />
        <meshBasicMaterial color="#fafafa" fog={false} />
      </mesh>

      {/* Main wings (long axis along Z, perpendicular to flight) */}
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[1.6, 0.08, 6.4]} />
        <meshBasicMaterial color="#e2e8f0" fog={false} />
      </mesh>

      {/* Wing-tip accent stripes */}
      <mesh position={[0, -0.06, -3.05]}>
        <boxGeometry args={[1.2, 0.09, 0.32]} />
        <meshBasicMaterial color="#2563eb" fog={false} />
      </mesh>
      <mesh position={[0, -0.06, 3.05]}>
        <boxGeometry args={[1.2, 0.09, 0.32]} />
        <meshBasicMaterial color="#2563eb" fog={false} />
      </mesh>

      {/* Horizontal tail stabilizer */}
      <mesh position={[-1.7, 0.05, 0]}>
        <boxGeometry args={[0.7, 0.06, 2.2]} />
        <meshBasicMaterial color="#e2e8f0" fog={false} />
      </mesh>

      {/* Vertical tail fin */}
      <mesh position={[-1.75, 0.52, 0]}>
        <boxGeometry args={[0.55, 0.85, 0.08]} />
        <meshBasicMaterial color="#2563eb" fog={false} />
      </mesh>

      {/* Cockpit window (dark, near the nose) */}
      <mesh position={[1.25, 0.22, 0]}>
        <boxGeometry args={[1.3, 0.14, 0.5]} />
        <meshBasicMaterial color="#0f172a" fog={false} />
      </mesh>

      {/* Passenger window strip along the fuselage */}
      <mesh position={[-0.35, 0.12, 0]}>
        <boxGeometry args={[2.2, 0.08, 0.58]} />
        <meshBasicMaterial color="#1e3a8a" fog={false} />
      </mesh>

      {/* Contrail puffs trailing behind the tail, fading out */}
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[-2.6 - i * 0.85, 0, 0]}>
          <sphereGeometry args={[0.28 - i * 0.035, 10, 8]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.55 - i * 0.1}
            depthWrite={false}
            fog={false}
          />
        </mesh>
      ))}
    </group>
  );
}

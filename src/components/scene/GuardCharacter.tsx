import { useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import { GUARD_BACK } from '@/lib/constants';
import { cameraBaseY } from '@/lib/roofRun';
import { terrainAngle, terrainHeight } from '@/lib/terrain';
import type { ChunkSpec, RunnerPose, WorkoutSceneVariant } from '@/lib/types';
import { RoundedBox } from './RoundedBox';

/**
 * The inspector chasing the runner - white uniform, peaked cap, pumping
 * arms - permanently trailing GUARD_BACK meters behind, filling the bottom
 * of the frame like the reference shot.
 *
 * He follows the runner's lane with a lag (so lane changes read as the
 * runner escaping sideways) and always stays on the ground: he never
 * jumps, ducks, or climbs onto train roofs. While the runner is up on a
 * roof-run he simply keeps pace on the track below.
 */

const UNIFORM = '#eef0f2';
const UNIFORM_SHADE = '#cfd5da';
const CAP_TOP = '#f4f6f8';
const CAP_BAND = '#2c3848';
const SKIN = '#e8a878';
const BELT = '#2c3848';

type Props = {
  runnerRef: MutableRefObject<THREE.Group | null>;
  poseRef: MutableRefObject<RunnerPose>;
  chunksRef: MutableRefObject<ChunkSpec[]>;
  paused?: boolean;
  variant?: WorkoutSceneVariant;
};

export function GuardCharacter({ runnerRef, poseRef, chunksRef, paused, variant }: Props) {
  const guardRef = useRef<THREE.Group>(null);
  const armLRef = useRef<THREE.Group>(null);
  const armRRef = useRef<THREE.Group>(null);
  const legLRef = useRef<THREE.Group>(null);
  const legRRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    const guard = guardRef.current;
    const runner = runnerRef.current;
    if (!guard || !runner) return;

    // Trail the runner; lag the lane-follow so the chase feels alive.
    guard.position.z = runner.position.z + GUARD_BACK;
    if (!paused) {
      const k = 1 - Math.exp(-5.5 * Math.min(dt, 0.05));
      guard.position.x += (runner.position.x - guard.position.x) * k;
      // Follow the floor at HIS position: the sloped terrain plus any train
      // roof height during roof-run sections so he doesn't clip through.
      guard.position.y =
        cameraBaseY(chunksRef.current, guard.position.z) +
        terrainHeight(variant, guard.position.z);
    }

    // Reuse the runner's stride phase (offset half a cycle so the two
    // characters don't run in lockstep).
    const phase = poseRef.current.runPhase + Math.PI * 0.6;
    const swing = Math.sin(phase) * 0.8;
    const armL = armLRef.current;
    const armR = armRRef.current;
    const legL = legLRef.current;
    const legR = legRRef.current;
    const body = bodyRef.current;
    if (armL && armR && legL && legR && body) {
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.9;
      armR.rotation.x = swing * 0.9;
      body.position.y = Math.abs(Math.sin(phase)) * 0.045;
      // Heavyset chase lean, plus the ramp pitch so he climbs with the runner.
      guard.rotation.x = -0.16 + terrainAngle(variant, guard.position.z);
    }
  });

  return (
    <group ref={guardRef} position={[0, 0, GUARD_BACK]}>
      {/* === LEGS === */}
      {([-1, 1] as const).map((side) => (
        <group
          key={`gleg-${side}`}
          ref={side === -1 ? legLRef : legRRef}
          position={[side * 0.13, 0.78, 0]}
        >
          <RoundedBox args={[0.17, 0.56, 0.19, 2, 0.06]} position={[0, -0.28, 0]}>
            <meshLambertMaterial color={CAP_BAND} />
          </RoundedBox>
          <RoundedBox args={[0.19, 0.12, 0.32, 2, 0.04]} position={[0, -0.6, -0.05]}>
            <meshLambertMaterial color="#23272e" />
          </RoundedBox>
        </group>
      ))}

      <group ref={bodyRef}>
        {/* Heavyset torso in white uniform */}
        <RoundedBox args={[0.56, 0.52, 0.4, 3, 0.12]} position={[0, 1.05, 0]}>
          <meshLambertMaterial color={UNIFORM} />
        </RoundedBox>
        {/* Belt */}
        <RoundedBox args={[0.58, 0.1, 0.42, 2, 0.04]} position={[0, 0.8, 0]}>
          <meshLambertMaterial color={BELT} />
        </RoundedBox>
        {/* Shoulder boards */}
        {([-1, 1] as const).map((side) => (
          <RoundedBox
            key={`board-${side}`}
            args={[0.14, 0.05, 0.2, 2, 0.02]}
            position={[side * 0.27, 1.32, 0]}
          >
            <meshLambertMaterial color={UNIFORM_SHADE} />
          </RoundedBox>
        ))}

        {/* === ARMS === */}
        {([-1, 1] as const).map((side) => (
          <group
            key={`garm-${side}`}
            ref={side === -1 ? armLRef : armRRef}
            position={[side * 0.34, 1.26, 0]}
          >
            <RoundedBox
              args={[0.14, 0.44, 0.15, 2, 0.05]}
              position={[0, -0.22, 0]}
              rotation={[0, 0, side * -0.1]}
            >
              <meshLambertMaterial color={UNIFORM} />
            </RoundedBox>
            <mesh position={[side * 0.03, -0.48, 0]}>
              <sphereGeometry args={[0.075, 10, 8]} />
              <meshLambertMaterial color={SKIN} />
            </mesh>
          </group>
        ))}

        {/* === HEAD + PEAKED CAP === */}
        <group position={[0, 1.56, 0]}>
          <RoundedBox args={[0.36, 0.34, 0.34, 3, 0.12]}>
            <meshLambertMaterial color={SKIN} />
          </RoundedBox>
          {/* Mustache */}
          <mesh position={[0, -0.07, -0.176]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[0.18, 0.06]} />
            <meshBasicMaterial color="#4a3526" />
          </mesh>
          {/* Cap band + crown + visor (visor points forward, -Z) */}
          <RoundedBox args={[0.38, 0.1, 0.36, 2, 0.04]} position={[0, 0.17, 0]}>
            <meshLambertMaterial color={CAP_BAND} />
          </RoundedBox>
          <RoundedBox args={[0.4, 0.12, 0.38, 3, 0.06]} position={[0, 0.27, 0.02]}>
            <meshLambertMaterial color={CAP_TOP} />
          </RoundedBox>
          <RoundedBox args={[0.32, 0.04, 0.18, 2, 0.02]} position={[0, 0.14, -0.24]}>
            <meshLambertMaterial color={CAP_BAND} />
          </RoundedBox>
        </group>
      </group>
    </group>
  );
}

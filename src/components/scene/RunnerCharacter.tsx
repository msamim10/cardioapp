import { useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import type { RunnerPose } from '@/lib/types';
import { RoundedBox } from './RoundedBox';

/**
 * The visible player: a big-headed cartoon runner in the Subway Surfers
 * proportion language (oversized head, slender limbs, chunky sneakers,
 * backwards cap). Built entirely from primitives and animated procedurally:
 *
 *  - run cycle: opposing arm/leg swings + vertical bob, driven by
 *    pose.runPhase which the AutoRunner advances with forward speed
 *  - jump: legs tuck up, arms raise
 *  - duck: full forward somersault (tumble) with a squash
 *  - lane change: body lean into the move
 *
 * The parent group (runnerRef in SubwayScene) carries the world position;
 * this component only poses limbs relative to the feet origin.
 */

const SKIN = '#f0b488';
const CAP = '#e23b3b';
const HOODIE = '#2aa9e0';
const HOODIE_DARK = '#1d86b5';
const PANTS = '#2c3848';
const SHOE = '#f3efe6';
const SHOE_SOLE = '#e23b3b';

type Props = {
  poseRef: MutableRefObject<RunnerPose>;
};

export function RunnerCharacter({ poseRef }: Props) {
  const tumbleRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const hipLRef = useRef<THREE.Group>(null);
  const hipRRef = useRef<THREE.Group>(null);
  const armLRef = useRef<THREE.Group>(null);
  const armRRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const pose = poseRef.current;
    const tumble = tumbleRef.current;
    const body = bodyRef.current;
    const hipL = hipLRef.current;
    const hipR = hipRRef.current;
    const armL = armLRef.current;
    const armR = armRRef.current;
    if (!tumble || !body || !hipL || !hipR || !armL || !armR) return;

    const { runPhase, jumpT, duckT, lean } = pose;

    // How much the regular run cycle drives the limbs (fades out in the
    // air and while rolling).
    const airAmount = jumpT > 0 ? Math.sin(Math.PI * jumpT) : 0;
    const rollAmount = duckT > 0 ? Math.sin(Math.PI * duckT) : 0;
    const runAmount = Math.max(0, 1 - airAmount - rollAmount);

    const swing = Math.sin(runPhase) * 0.9;

    // Legs: opposing swing, tucked up during the jump arc.
    hipL.rotation.x = swing * runAmount - 1.5 * airAmount - 1.9 * rollAmount;
    hipR.rotation.x = -swing * runAmount - 1.5 * airAmount - 1.9 * rollAmount;

    // Arms: opposite phase to legs, thrown up mid-jump, hugged in for rolls.
    armL.rotation.x = -swing * 0.85 * runAmount - 2.2 * airAmount - 1.4 * rollAmount;
    armR.rotation.x = swing * 0.85 * runAmount - 2.2 * airAmount - 1.4 * rollAmount;

    // Run bob + slight forward racing lean.
    body.position.y = Math.abs(Math.sin(runPhase)) * 0.05 * runAmount;
    tumble.rotation.x = -0.12 * runAmount - Math.PI * 2 * duckT;

    // Lane-change lean (negative lean = moving left = tilt left).
    tumble.rotation.z = -lean * 0.3;

    // Squash during the somersault so the ball stays under the barrier.
    const squash = 1 - 0.32 * rollAmount;
    tumble.scale.setScalar(1);
    tumble.scale.y = squash;
    // While rolling, drop the tumble pivot toward the ground.
    tumble.position.y = 0.92 - 0.3 * rollAmount;
  });

  return (
    <group>
      {/* Tumble pivot sits at the hips so the somersault rotates the whole
          body around its center of mass. */}
      <group ref={tumbleRef} position={[0, 0.92, 0]}>
        <group position={[0, -0.92, 0]}>
          {/* === LEGS (pivot at hips, y=0.86) === */}
          {([-1, 1] as const).map((side) => (
            <group
              key={`leg-${side}`}
              ref={side === -1 ? hipLRef : hipRRef}
              position={[side * 0.11, 0.86, 0]}
            >
              {/* Thigh + shin as one slender limb */}
              <RoundedBox args={[0.15, 0.62, 0.17, 2, 0.06]} position={[0, -0.31, 0]}>
                <meshLambertMaterial color={PANTS} />
              </RoundedBox>
              {/* Chunky sneaker */}
              <group position={[0, -0.66, -0.05]}>
                <RoundedBox args={[0.18, 0.13, 0.34, 2, 0.05]}>
                  <meshLambertMaterial color={SHOE} />
                </RoundedBox>
                <RoundedBox args={[0.19, 0.06, 0.35, 2, 0.025]} position={[0, -0.07, 0]}>
                  <meshLambertMaterial color={SHOE_SOLE} />
                </RoundedBox>
              </group>
            </group>
          ))}

          {/* === TORSO + HEAD (bobbing body group) === */}
          <group ref={bodyRef}>
            {/* Hoodie torso */}
            <RoundedBox args={[0.44, 0.5, 0.3, 3, 0.1]} position={[0, 1.12, 0]}>
              <meshLambertMaterial color={HOODIE} />
            </RoundedBox>
            {/* Hoodie pocket stripe (front face, -Z) */}
            <mesh position={[0, 0.98, -0.155]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[0.3, 0.14]} />
              <meshBasicMaterial color={HOODIE_DARK} />
            </mesh>
            {/* Hood bump behind the neck */}
            <RoundedBox args={[0.3, 0.16, 0.14, 2, 0.06]} position={[0, 1.38, 0.16]}>
              <meshLambertMaterial color={HOODIE_DARK} />
            </RoundedBox>

            {/* === ARMS (pivot at shoulders, y=1.32) === */}
            {([-1, 1] as const).map((side) => (
              <group
                key={`arm-${side}`}
                ref={side === -1 ? armLRef : armRRef}
                position={[side * 0.28, 1.32, 0]}
              >
                <RoundedBox
                  args={[0.12, 0.46, 0.13, 2, 0.05]}
                  position={[0, -0.23, 0]}
                  rotation={[0, 0, side * -0.08]}
                >
                  <meshLambertMaterial color={HOODIE} />
                </RoundedBox>
                {/* Hand */}
                <mesh position={[side * 0.02, -0.5, 0]}>
                  <sphereGeometry args={[0.07, 10, 8]} />
                  <meshLambertMaterial color={SKIN} />
                </mesh>
              </group>
            ))}

            {/* === BIG HEAD === */}
            <group position={[0, 1.62, 0]}>
              <RoundedBox args={[0.4, 0.38, 0.38, 3, 0.13]}>
                <meshLambertMaterial color={SKIN} />
              </RoundedBox>
              {/* Backwards cap: crown + rear brim */}
              <RoundedBox args={[0.42, 0.16, 0.4, 3, 0.08]} position={[0, 0.16, 0]}>
                <meshLambertMaterial color={CAP} />
              </RoundedBox>
              <RoundedBox args={[0.3, 0.05, 0.22, 2, 0.02]} position={[0, 0.12, 0.28]}>
                <meshLambertMaterial color={CAP} />
              </RoundedBox>
              {/* Hair peeking under the cap (front face, -Z) */}
              <mesh position={[0, 0.06, -0.195]} rotation={[0, Math.PI, 0]}>
                <planeGeometry args={[0.36, 0.08]} />
                <meshBasicMaterial color="#3c2a1e" />
              </mesh>
              {/* Eyes (facing -Z, the direction of travel) */}
              {[-0.09, 0.09].map((ex, i) => (
                <mesh key={`eye-${i}`} position={[ex, -0.02, -0.196]} rotation={[0, Math.PI, 0]}>
                  <circleGeometry args={[0.035, 10]} />
                  <meshBasicMaterial color="#1c2430" />
                </mesh>
              ))}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

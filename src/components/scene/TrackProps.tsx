import { ARCADE_PALETTE } from '@/lib/constants';
import { RoundedBox } from './RoundedBox';

/**
 * Rail-yard clutter for the ballast shoulders between the outer rails and
 * the graffiti walls: crate stacks, oil drums, cable reels, signal relay
 * boxes, pallets, and tire stacks. Each variant is a self-contained group
 * of primitives, spawned sparsely so the corridor stays readable.
 */

export type TrackPropSpec = {
  kind: 'crates' | 'barrels' | 'cableReel' | 'signalBox' | 'pallet' | 'tireStack';
  x: number;
  z: number;
  rotY: number;
  accent: string;
};

export function TrackProp({ spec }: { spec: TrackPropSpec }) {
  return (
    <group position={[spec.x, 0, spec.z]} rotation={[0, spec.rotY, 0]}>
      {spec.kind === 'crates' && <CrateStack accent={spec.accent} />}
      {spec.kind === 'barrels' && <Barrels accent={spec.accent} />}
      {spec.kind === 'cableReel' && <CableReel />}
      {spec.kind === 'signalBox' && <SignalBox accent={spec.accent} />}
      {spec.kind === 'pallet' && <Pallet />}
      {spec.kind === 'tireStack' && <TireStack />}
    </group>
  );
}

function CrateStack({ accent }: { accent: string }) {
  return (
    <group>
      <RoundedBox args={[0.62, 0.62, 0.62, 2, 0.05]} position={[0, 0.31, 0]}>
        <meshLambertMaterial color="#a3764a" />
      </RoundedBox>
      <RoundedBox args={[0.5, 0.5, 0.5, 2, 0.05]} position={[0.12, 0.87, 0.06]}>
        <meshLambertMaterial color={accent} />
      </RoundedBox>
      {/* Plank lines */}
      <mesh position={[0, 0.31, 0.315]}>
        <planeGeometry args={[0.62, 0.06]} />
        <meshBasicMaterial color="#7c5532" />
      </mesh>
    </group>
  );
}

function Barrels({ accent }: { accent: string }) {
  return (
    <group>
      {[
        { x: 0, z: 0, color: accent },
        { x: 0.42, z: 0.18, color: '#4b5563' },
      ].map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]}>
          <mesh position={[0, 0.4, 0]}>
            <cylinderGeometry args={[0.26, 0.26, 0.8, 14]} />
            <meshLambertMaterial color={b.color} />
          </mesh>
          {/* Rib rings */}
          {[0.22, 0.58].map((y, j) => (
            <mesh key={j} position={[0, y, 0]}>
              <cylinderGeometry args={[0.275, 0.275, 0.045, 14]} />
              <meshLambertMaterial color="#1f2937" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function CableReel() {
  return (
    <group rotation={[0, 0, Math.PI / 2]} position={[0, 0.42, 0]}>
      {[-0.26, 0.26].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <cylinderGeometry args={[0.42, 0.42, 0.07, 16]} />
          <meshLambertMaterial color="#b08653" />
        </mesh>
      ))}
      <mesh>
        <cylinderGeometry args={[0.2, 0.2, 0.46, 14]} />
        <meshLambertMaterial color="#8a6238" />
      </mesh>
    </group>
  );
}

function SignalBox({ accent }: { accent: string }) {
  return (
    <group>
      <RoundedBox args={[0.7, 1.1, 0.45, 3, 0.06]} position={[0, 0.55, 0]}>
        <meshLambertMaterial color={ARCADE_PALETTE.steelLight} />
      </RoundedBox>
      {/* Door panel */}
      <mesh position={[0, 0.55, 0.232]}>
        <planeGeometry args={[0.5, 0.85]} />
        <meshBasicMaterial color={ARCADE_PALETTE.steel} />
      </mesh>
      {/* Warning sticker */}
      <mesh position={[0, 0.78, 0.24]}>
        <planeGeometry args={[0.22, 0.22]} />
        <meshBasicMaterial color={accent} />
      </mesh>
    </group>
  );
}

function Pallet() {
  return (
    <group>
      {[-0.3, 0, 0.3].map((z, i) => (
        <mesh key={i} position={[0, 0.06, z]}>
          <boxGeometry args={[0.9, 0.05, 0.12]} />
          <meshLambertMaterial color="#a3764a" />
        </mesh>
      ))}
      {[-0.38, 0.38].map((x, i) => (
        <mesh key={`run-${i}`} position={[x, 0.02, 0]}>
          <boxGeometry args={[0.1, 0.08, 0.75]} />
          <meshLambertMaterial color="#7c5532" />
        </mesh>
      ))}
    </group>
  );
}

function TireStack() {
  return (
    <group>
      {[0.12, 0.34, 0.56].map((y, i) => (
        <mesh
          key={i}
          position={[i === 2 ? 0.05 : 0, y, i === 1 ? 0.04 : 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.26, 0.11, 8, 16]} />
          <meshLambertMaterial color="#23272e" />
        </mesh>
      ))}
    </group>
  );
}

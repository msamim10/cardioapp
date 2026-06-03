import { ARCADE_PALETTE } from '@/lib/constants';
import { RoundedBox } from './RoundedBox';

/**
 * Tiny city-street props for the strip between the jersey barrier and the
 * building skyline. Each variant is a self-contained group built from
 * primitives. Spawned sparsely so the scene doesn't get cluttered.
 */

export type StreetPropSpec = {
  kind: 'hydrant' | 'trashcan' | 'bench' | 'vendor' | 'stopsign' | 'newsbox';
  x: number;
  z: number;
  rotY: number;
  accent: string;
};

export function StreetProp({ spec }: { spec: StreetPropSpec }) {
  return (
    <group position={[spec.x, 0, spec.z]} rotation={[0, spec.rotY, 0]}>
      {spec.kind === 'hydrant' && <Hydrant />}
      {spec.kind === 'trashcan' && <TrashCan />}
      {spec.kind === 'bench' && <Bench />}
      {spec.kind === 'vendor' && <VendorStall accent={spec.accent} />}
      {spec.kind === 'stopsign' && <StopSign />}
      {spec.kind === 'newsbox' && <NewsBox accent={spec.accent} />}
    </group>
  );
}

function Hydrant() {
  return (
    <group>
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.22, 0.26, 0.36, 12]} />
        <meshLambertMaterial color="#dc2626" />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <sphereGeometry args={[0.18, 14, 12]} />
        <meshLambertMaterial color="#dc2626" />
      </mesh>
      {[-1, 1].map((s, i) => (
        <mesh key={i} position={[s * 0.22, 0.22, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.08, 0.08, 0.16, 10]} />
          <meshLambertMaterial color="#fde047" />
        </mesh>
      ))}
      {/* Top valve cap */}
      <mesh position={[0, 0.58, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.08, 8]} />
        <meshLambertMaterial color="#fde047" />
      </mesh>
    </group>
  );
}

function TrashCan() {
  return (
    <group>
      <mesh position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.32, 0.28, 0.9, 14]} />
        <meshLambertMaterial color="#374151" />
      </mesh>
      <RoundedBox args={[0.68, 0.1, 0.68, 2, 0.04]} position={[0, 0.95, 0]}>
        <meshLambertMaterial color="#1f2937" />
      </RoundedBox>
      {/* Brand stripe */}
      <mesh position={[0, 0.55, 0.32]}>
        <planeGeometry args={[0.4, 0.18]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>
    </group>
  );
}

function Bench() {
  return (
    <group>
      {/* Seat slats */}
      {[-0.18, 0.0, 0.18].map((dz, i) => (
        <RoundedBox key={i} args={[1.4, 0.06, 0.14, 2, 0.02]} position={[0, 0.45, dz]}>
          <meshLambertMaterial color="#8b5e34" />
        </RoundedBox>
      ))}
      {/* Backrest */}
      {[0.6, 0.78].map((y, i) => (
        <RoundedBox key={`back-${i}`} args={[1.4, 0.06, 0.06, 2, 0.02]} position={[0, y, -0.22]}>
          <meshLambertMaterial color="#8b5e34" />
        </RoundedBox>
      ))}
      {/* Legs */}
      {[-0.6, 0.6].map((lx, i) => (
        <group key={`leg-${i}`} position={[lx, 0, 0]}>
          <RoundedBox args={[0.08, 0.45, 0.4, 2, 0.02]} position={[0, 0.22, 0]}>
            <meshLambertMaterial color="#1f2937" />
          </RoundedBox>
          <RoundedBox args={[0.08, 0.78, 0.06, 2, 0.02]} position={[0, 0.4, -0.22]}>
            <meshLambertMaterial color="#1f2937" />
          </RoundedBox>
        </group>
      ))}
    </group>
  );
}

function VendorStall({ accent }: { accent: string }) {
  return (
    <group>
      {/* Counter */}
      <RoundedBox args={[1.4, 0.95, 0.7, 3, 0.08]} position={[0, 0.475, 0]}>
        <meshLambertMaterial color="#fef3c7" />
      </RoundedBox>
      {/* Side accent panels */}
      {[-0.55, 0.55].map((lx, i) => (
        <mesh key={i} position={[lx, 0.475, 0.355]}>
          <planeGeometry args={[0.3, 0.7]} />
          <meshBasicMaterial color={accent} />
        </mesh>
      ))}
      {/* Awning posts */}
      {[-0.6, 0.6].map((lx, i) => (
        <RoundedBox key={`post-${i}`} args={[0.06, 0.9, 0.06, 2, 0.02]} position={[lx, 1.4, 0]}>
          <meshLambertMaterial color="#1f2937" />
        </RoundedBox>
      ))}
      {/* Striped awning */}
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh
          key={`awning-${i}`}
          position={[-0.6 + i * 0.24, 1.95, 0]}
          rotation={[Math.PI / 8, 0, 0]}
        >
          <planeGeometry args={[0.24, 0.78]} />
          <meshBasicMaterial color={i % 2 === 0 ? '#dc2626' : '#fef9f5'} />
        </mesh>
      ))}
      {/* Sign */}
      <mesh position={[0, 1.05, 0.36]}>
        <planeGeometry args={[0.9, 0.32]} />
        <meshBasicMaterial color={accent} />
      </mesh>
    </group>
  );
}

function StopSign() {
  return (
    <group>
      <RoundedBox args={[0.06, 2.4, 0.06, 2, 0.02]} position={[0, 1.2, 0]}>
        <meshLambertMaterial color="#9aa3b2" />
      </RoundedBox>
      <mesh position={[0, 2.3, 0]} rotation={[0, 0, Math.PI / 8]}>
        <circleGeometry args={[0.36, 8]} />
        <meshBasicMaterial color="#dc2626" />
      </mesh>
      <mesh position={[0, 2.3, 0.005]} rotation={[0, 0, Math.PI / 8]}>
        <ringGeometry args={[0.3, 0.34, 8]} />
        <meshBasicMaterial color="#fef9f5" />
      </mesh>
      {/* Letters bar */}
      <mesh position={[0, 2.3, 0.01]}>
        <planeGeometry args={[0.42, 0.1]} />
        <meshBasicMaterial color="#fef9f5" />
      </mesh>
    </group>
  );
}

function NewsBox({ accent }: { accent: string }) {
  return (
    <group>
      <RoundedBox args={[0.55, 0.95, 0.42, 3, 0.06]} position={[0, 0.55, 0]}>
        <meshLambertMaterial color={accent} />
      </RoundedBox>
      {/* Glass window */}
      <mesh position={[0, 0.7, 0.215]}>
        <planeGeometry args={[0.38, 0.38]} />
        <meshBasicMaterial color={ARCADE_PALETTE.windowsDark} />
      </mesh>
      {/* Legs */}
      {[-0.18, 0.18].map((lx, i) => (
        <mesh key={i} position={[lx, 0.04, 0]}>
          <boxGeometry args={[0.05, 0.08, 0.32]} />
          <meshLambertMaterial color="#1f2937" />
        </mesh>
      ))}
    </group>
  );
}

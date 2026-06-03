import { useMemo } from 'react';
import { ARCADE_PALETTE } from '@/lib/constants';
import { getModelAsset, type ModelKey } from '@/lib/modelRegistry';
import { Graffiti } from './Graffiti';
import { GLBModel } from './models/GLBModel';
import { RoundedBox } from './RoundedBox';

/**
 * Procedurally generated background buildings.
 *
 * Five primitive silhouettes (simple tower, stepped/setback tower, L-shape,
 * cylinder tower, pyramid-top) are mixed along the skyline. The chooser is
 * seeded so the same chunk index always produces the same buildings.
 *
 * If real GLB models are enabled in src/lib/modelRegistry.ts, the
 * `buildingA..I` assets are used instead of the primitive silhouettes.
 */

const BUILDING_MODEL_KEYS: ModelKey[] = [
  'buildingA',
  'buildingA',
  'buildingB',
  'buildingC',
  'buildingD',
  'buildingE',
  'buildingF',
];

export type BuildingSpec = {
  variant: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  bodyColor: string;
  accentColor: string;
  windowRows: number;
  hasGraffiti: boolean;
  graffitiSeed: number;
  hasRoofBox: boolean;
  hasSign: boolean;
  hasFireExit: boolean;
  hasWashingLine: boolean;
  hasSideBusStop: boolean;
  signColor: string;
  facingIn: -1 | 1; // which side the graffiti faces
};

export function Building({ spec }: { spec: BuildingSpec }) {
  const modelKey = BUILDING_MODEL_KEYS[spec.variant % BUILDING_MODEL_KEYS.length];
  const asset = getModelAsset(modelKey);
  if (asset) {
    // GLB only - no primitive fallback. The workout screen preloads all
    // models during the countdown so the first chunk renders instantly.
    return (
      <group>
        <GLBModel
          assetModule={asset}
          fitHeight={spec.height}
          scale={[0.6, 1.32, 0.78]}
          position={[spec.x, 0, spec.z]}
          rotation={[0, spec.x > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
        />
        {spec.hasFireExit && <FireExitAttachment spec={spec} />}
        {spec.hasWashingLine && <WashingLineAttachment spec={spec} />}
        {spec.hasSideBusStop && <SideBusStopAttachment spec={spec} />}
      </group>
    );
  }
  return <PrimitiveBuilding spec={spec} />;
}

function FireExitAttachment({ spec }: { spec: BuildingSpec }) {
  const asset = getModelAsset('fireExit');
  if (!asset) return null;
  const side = spec.x > 0 ? -1 : 1;
  return (
    <GLBModel
      assetModule={asset}
      fitHeight={Math.min(2.6, spec.height * 0.34)}
      position={[
        spec.x + side * 0.82,
        spec.height * 0.34,
        spec.z - 0.08,
      ]}
      rotation={[0, spec.x > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
    />
  );
}

function WashingLineAttachment({ spec }: { spec: BuildingSpec }) {
  const asset = getModelAsset('washingLine');
  if (!asset) return null;
  const side = spec.x > 0 ? -1 : 1;
  return (
    <GLBModel
      assetModule={asset}
      fitHeight={Math.min(1.35, spec.height * 0.16)}
      position={[
        spec.x + side * 0.92,
        spec.height * 0.56,
        spec.z + 0.18,
      ]}
      rotation={[0, spec.x > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
    />
  );
}

function SideBusStopAttachment({ spec }: { spec: BuildingSpec }) {
  const asset = getModelAsset('busStop');
  if (!asset) return null;
  const side = spec.x > 0 ? -1 : 1;
  return (
    <GLBModel
      assetModule={asset}
      fitHeight={1.3}
      position={[
        spec.x + side * 0.95,
        0,
        spec.z - 0.55,
      ]}
      rotation={[0, spec.x > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
    />
  );
}

function PrimitiveBuilding({ spec }: { spec: BuildingSpec }) {
  switch (spec.variant) {
    case 1:
      return <SteppedTower spec={spec} />;
    case 2:
      return <LShapeBuilding spec={spec} />;
    case 3:
      return <CylinderTower spec={spec} />;
    case 4:
      return <PyramidTopBuilding spec={spec} />;
    case 0:
    default:
      return <SimpleTower spec={spec} />;
  }
}

function SimpleTower({ spec }: { spec: BuildingSpec }) {
  return (
    <group position={[spec.x, spec.height / 2, spec.z]}>
      <RoundedBox args={[spec.width, spec.height, spec.depth, 3, 0.18]}>
        <meshLambertMaterial color={spec.bodyColor} />
      </RoundedBox>
      <WindowGrid
        width={spec.width * 0.78}
        height={spec.height * 0.7}
        rows={spec.windowRows}
        cols={3}
        faceZ={spec.depth / 2 + 0.02}
      />
      {spec.hasGraffiti && (
        <Graffiti
          width={spec.width * 0.7}
          height={Math.min(2.4, spec.height * 0.35)}
          position={[
            spec.facingIn === 1 ? -spec.width / 2 - 0.02 : spec.width / 2 + 0.02,
            -spec.height * 0.2,
            0,
          ]}
          rotation={[0, spec.facingIn === 1 ? Math.PI / 2 : -Math.PI / 2, 0]}
          seed={spec.graffitiSeed}
        />
      )}
      {spec.hasRoofBox && (
        <RoundedBox
          args={[spec.width * 0.35, 0.7, spec.depth * 0.4, 3, 0.1]}
          position={[0, spec.height / 2 + 0.4, 0]}
        >
          <meshLambertMaterial color={spec.accentColor} />
        </RoundedBox>
      )}
      {spec.hasSign && (
        <mesh position={[0, -spec.height / 2 + 0.6, spec.depth / 2 + 0.025]}>
          <planeGeometry args={[spec.width * 0.7, 0.7]} />
          <meshBasicMaterial color={spec.signColor} />
        </mesh>
      )}
    </group>
  );
}

function SteppedTower({ spec }: { spec: BuildingSpec }) {
  // 3 stacked boxes (Empire State Building / Art Deco vibe)
  const seg = spec.height / 1.9;
  const w1 = spec.width;
  const w2 = spec.width * 0.78;
  const w3 = spec.width * 0.5;
  const d1 = spec.depth;
  const d2 = spec.depth * 0.82;
  const d3 = spec.depth * 0.55;
  const h1 = seg * 0.95;
  const h2 = seg * 0.62;
  const h3 = seg * 0.35;
  return (
    <group position={[spec.x, 0, spec.z]}>
      <group position={[0, h1 / 2, 0]}>
        <RoundedBox args={[w1, h1, d1, 3, 0.18]}>
          <meshLambertMaterial color={spec.bodyColor} />
        </RoundedBox>
        <WindowGrid
          width={w1 * 0.78}
          height={h1 * 0.7}
          rows={Math.max(2, Math.floor(h1 / 1.5))}
          cols={3}
          faceZ={d1 / 2 + 0.02}
        />
        {spec.hasSign && (
          <mesh position={[0, -h1 / 2 + 0.5, d1 / 2 + 0.025]}>
            <planeGeometry args={[w1 * 0.7, 0.6]} />
            <meshBasicMaterial color={spec.signColor} />
          </mesh>
        )}
      </group>
      <group position={[0, h1 + h2 / 2, 0]}>
        <RoundedBox args={[w2, h2, d2, 3, 0.15]}>
          <meshLambertMaterial color={spec.accentColor} />
        </RoundedBox>
        <WindowGrid
          width={w2 * 0.75}
          height={h2 * 0.7}
          rows={Math.max(1, Math.floor(h2 / 1.4))}
          cols={3}
          faceZ={d2 / 2 + 0.02}
        />
      </group>
      <group position={[0, h1 + h2 + h3 / 2, 0]}>
        <RoundedBox args={[w3, h3, d3, 3, 0.12]}>
          <meshLambertMaterial color={spec.bodyColor} />
        </RoundedBox>
      </group>
      {/* Antenna spire */}
      <mesh position={[0, h1 + h2 + h3 + 0.6, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 1.2, 6]} />
        <meshLambertMaterial color="#1f2937" />
      </mesh>
      {spec.hasGraffiti && (
        <Graffiti
          width={w1 * 0.6}
          height={Math.min(1.8, h1 * 0.35)}
          position={[
            spec.facingIn === 1 ? -w1 / 2 - 0.02 : w1 / 2 + 0.02,
            h1 * 0.32,
            0,
          ]}
          rotation={[0, spec.facingIn === 1 ? Math.PI / 2 : -Math.PI / 2, 0]}
          seed={spec.graffitiSeed}
        />
      )}
    </group>
  );
}

function LShapeBuilding({ spec }: { spec: BuildingSpec }) {
  // Two boxes joined to form an L footprint
  const main = { w: spec.width, h: spec.height, d: spec.depth };
  const wing = { w: spec.width * 0.55, h: spec.height * 0.75, d: spec.depth * 0.6 };
  const wingOffsetX = spec.facingIn === 1 ? main.w / 2 + wing.w / 2 - 0.1 : -(main.w / 2 + wing.w / 2 - 0.1);
  return (
    <group position={[spec.x, 0, spec.z]}>
      <group position={[0, main.h / 2, 0]}>
        <RoundedBox args={[main.w, main.h, main.d, 3, 0.18]}>
          <meshLambertMaterial color={spec.bodyColor} />
        </RoundedBox>
        <WindowGrid
          width={main.w * 0.78}
          height={main.h * 0.7}
          rows={Math.max(2, Math.floor(main.h / 1.5))}
          cols={3}
          faceZ={main.d / 2 + 0.02}
        />
        {spec.hasRoofBox && (
          <RoundedBox
            args={[main.w * 0.3, 0.6, main.d * 0.4, 3, 0.08]}
            position={[0, main.h / 2 + 0.35, 0]}
          >
            <meshLambertMaterial color={spec.accentColor} />
          </RoundedBox>
        )}
      </group>
      <group position={[wingOffsetX, wing.h / 2, -spec.depth * 0.15]}>
        <RoundedBox args={[wing.w, wing.h, wing.d, 3, 0.14]}>
          <meshLambertMaterial color={spec.accentColor} />
        </RoundedBox>
        <WindowGrid
          width={wing.w * 0.7}
          height={wing.h * 0.7}
          rows={Math.max(2, Math.floor(wing.h / 1.4))}
          cols={2}
          faceZ={wing.d / 2 + 0.02}
        />
      </group>
      {spec.hasGraffiti && (
        <Graffiti
          width={main.w * 0.65}
          height={Math.min(2.2, main.h * 0.4)}
          position={[
            spec.facingIn === 1 ? -main.w / 2 - 0.02 : main.w / 2 + 0.02,
            main.h * 0.28,
            0,
          ]}
          rotation={[0, spec.facingIn === 1 ? Math.PI / 2 : -Math.PI / 2, 0]}
          seed={spec.graffitiSeed}
        />
      )}
      {spec.hasSign && (
        <mesh position={[0, 0.6, main.d / 2 + 0.025]}>
          <planeGeometry args={[main.w * 0.7, 0.55]} />
          <meshBasicMaterial color={spec.signColor} />
        </mesh>
      )}
    </group>
  );
}

function CylinderTower({ spec }: { spec: BuildingSpec }) {
  const radius = Math.max(spec.width, spec.depth) * 0.5;
  return (
    <group position={[spec.x, spec.height / 2, spec.z]}>
      <mesh>
        <cylinderGeometry args={[radius, radius, spec.height, 18]} />
        <meshLambertMaterial color={spec.bodyColor} />
      </mesh>
      {/* Window bands - thin rings of dark windows around the body */}
      {Array.from({ length: Math.max(2, Math.floor(spec.height / 1.5)) }).map((_, r) => {
        const y = -spec.height / 2 + (r + 0.6) * (spec.height / (Math.floor(spec.height / 1.5) + 0.5));
        return (
          <group key={`band-${r}`} position={[0, y, 0]}>
            {Array.from({ length: 10 }).map((_, c) => {
              const a = (c / 10) * Math.PI * 2;
              return (
                <mesh
                  key={c}
                  position={[Math.sin(a) * (radius + 0.01), 0, Math.cos(a) * (radius + 0.01)]}
                  rotation={[0, a, 0]}
                >
                  <planeGeometry args={[0.32, 0.28]} />
                  <meshBasicMaterial
                    color={
                      (r * 10 + c) % 3 === 0
                        ? ARCADE_PALETTE.windowsDark
                        : ARCADE_PALETTE.windowsLit[c % ARCADE_PALETTE.windowsLit.length]
                    }
                  />
                </mesh>
              );
            })}
          </group>
        );
      })}
      {/* Dome on top */}
      <mesh position={[0, spec.height / 2 + radius * 0.4, 0]}>
        <sphereGeometry args={[radius * 0.95, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshLambertMaterial color={spec.accentColor} />
      </mesh>
      {spec.hasGraffiti && (
        <Graffiti
          width={radius * 1.4}
          height={Math.min(2.2, spec.height * 0.35)}
          position={[
            spec.facingIn === 1 ? -radius - 0.02 : radius + 0.02,
            -spec.height * 0.2,
            0,
          ]}
          rotation={[0, spec.facingIn === 1 ? Math.PI / 2 : -Math.PI / 2, 0]}
          seed={spec.graffitiSeed}
        />
      )}
    </group>
  );
}

function PyramidTopBuilding({ spec }: { spec: BuildingSpec }) {
  const bodyH = spec.height * 0.78;
  const peakH = spec.height * 0.32;
  return (
    <group position={[spec.x, 0, spec.z]}>
      <group position={[0, bodyH / 2, 0]}>
        <RoundedBox args={[spec.width, bodyH, spec.depth, 3, 0.18]}>
          <meshLambertMaterial color={spec.bodyColor} />
        </RoundedBox>
        <WindowGrid
          width={spec.width * 0.78}
          height={bodyH * 0.7}
          rows={Math.max(2, Math.floor(bodyH / 1.5))}
          cols={3}
          faceZ={spec.depth / 2 + 0.02}
        />
        {spec.hasSign && (
          <mesh position={[0, -bodyH / 2 + 0.6, spec.depth / 2 + 0.025]}>
            <planeGeometry args={[spec.width * 0.7, 0.65]} />
            <meshBasicMaterial color={spec.signColor} />
          </mesh>
        )}
      </group>
      {/* Pyramid roof */}
      <mesh position={[0, bodyH + peakH / 2, 0]}>
        <coneGeometry
          args={[Math.max(spec.width, spec.depth) * 0.65, peakH, 4]}
        />
        <meshLambertMaterial color={spec.accentColor} />
      </mesh>
      {spec.hasGraffiti && (
        <Graffiti
          width={spec.width * 0.65}
          height={Math.min(2.2, bodyH * 0.35)}
          position={[
            spec.facingIn === 1 ? -spec.width / 2 - 0.02 : spec.width / 2 + 0.02,
            bodyH * 0.25,
            0,
          ]}
          rotation={[0, spec.facingIn === 1 ? Math.PI / 2 : -Math.PI / 2, 0]}
          seed={spec.graffitiSeed}
        />
      )}
    </group>
  );
}

function WindowGrid({
  width,
  height,
  rows,
  cols,
  faceZ,
}: {
  width: number;
  height: number;
  rows: number;
  cols: number;
  faceZ: number;
}) {
  const items = useMemo(() => {
    const winW = width / (cols * 1.6);
    const winH = height / (rows * 1.9);
    const stepX = width / cols;
    const stepY = height / rows;
    const startX = -width / 2 + stepX / 2;
    const startY = -height / 2 + stepY / 2;
    const out: Array<{ x: number; y: number; w: number; h: number; lit: boolean; idx: number }> = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({
          x: startX + c * stepX,
          y: startY + r * stepY,
          w: winW,
          h: winH,
          lit: (r * 3 + c) % 3 !== 0,
          idx: idx++,
        });
      }
    }
    return out;
  }, [width, height, rows, cols]);

  return (
    <group position={[0, 0, faceZ]}>
      {items.map((w) => (
        <mesh key={w.idx} position={[w.x, w.y, 0]}>
          <planeGeometry args={[w.w, w.h]} />
          <meshBasicMaterial
            color={
              w.lit
                ? ARCADE_PALETTE.windowsLit[w.idx % ARCADE_PALETTE.windowsLit.length]
                : ARCADE_PALETTE.windowsDark
            }
          />
        </mesh>
      ))}
    </group>
  );
}

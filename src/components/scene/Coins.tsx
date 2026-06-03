import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/native';
import * as THREE from 'three';
import { CHUNK_LENGTH, LANE_X } from '@/lib/constants';
import {
  ROOF_TRAIN_OFFSETS,
  TRAIN_LENGTH,
  TRAIN_ROOF_COIN_Y,
} from '@/lib/roofRun';
import type { ChunkSpec, Lane } from '@/lib/types';

type CoinPos = {
  key: string;
  lane: Lane;
  x: number;
  baseY: number;
  z: number;
  phase: number;
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

const COIN_BASE_Y = 0.42;
const COIN_RADIUS = 0.22;
const COIN_THICKNESS = 0.08;
const COIN_SEGMENTS = 18;
const COIN_COLLECT_Z_WINDOW = 0.55;
const COIN_COLLECT_LANE_WINDOW = 0.7;

export function computeChunkCoins(chunk: ChunkSpec): CoinPos[] {
  // Roof-run chunks lay coin trails on top of the trains (and arc them up
  // over each jump) instead of using the normal ground-level layout.
  if (chunk.roofRun) {
    return computeRoofRunChunkCoins(chunk);
  }
  // Tie the layout to the chunk seed/id so recycled chunks get fresh coins and
  // collected ids never collide with a later recycled chunk.
  const rng = mulberry32(chunk.seed ^ chunk.id.length ^ 0x51f15e);
  // 30% chance a chunk has no coins (so the world isn't a constant stream)
  if (rng() < 0.3) return [];

  // Choose a lane to lay a coin row through; bias toward center lane for visibility
  const laneRoll = rng();
  const lane: Lane = laneRoll < 0.5 ? 0 : laneRoll < 0.75 ? -1 : 1;
  const x = LANE_X[lane.toString() as '-1' | '0' | '1'];

  const startZ = chunk.startZ - 3;
  const endZ = chunk.startZ - CHUNK_LENGTH + 3;
  const span = startZ - endZ;
  const count = 6 + Math.floor(rng() * 4);
  const step = span / count;
  const arcHeight = 0.18 + rng() * 0.12;

  const coins: CoinPos[] = [];
  for (let i = 0; i < count; i++) {
    // Arc the coins gently up and down across the chunk for that classic
    // "follow the coin trail" feel.
    const t = i / Math.max(1, count - 1);
    const arc = Math.sin(t * Math.PI) * arcHeight;
    coins.push({
      key: `${chunk.id}-coin-${i}`,
      lane,
      x,
      baseY: COIN_BASE_Y + arc,
      z: startZ - i * step,
      phase: rng() * Math.PI * 2 + i * 0.4,
    });
  }
  return coins;
}

function computeRoofRunChunkCoins(chunk: ChunkSpec): CoinPos[] {
  const { role, lane, variant } = chunk.roofRun!;
  const trainOffsets = ROOF_TRAIN_OFFSETS[role];
  const half = TRAIN_LENGTH / 2;
  // For the straight 'gap' variant, skip coins on this chunk's LAST train
  // whenever it leads into another forward jump (entry → run and run → run
  // / run → exit boundaries). That clears the player's view of the upcoming
  // gap so they can see the jump coming. The 'exit' chunk has its trains
  // attached to the previous run (no leading gap, no jump approaching it)
  // and the 'lane' variant uses sideways jumps, so both keep the full
  // 3-train coin trail. Intentionally still no coins over the jump gap
  // itself - the player shouldn't be reaching mid-air during a leap.
  const skipLastTrain =
    variant === 'gap' && (role === 'entry' || role === 'run');
  const usedOffsets = skipLastTrain
    ? trainOffsets.slice(0, -1)
    : trainOffsets;
  const firstZ = chunk.startZ + usedOffsets[0] + half - 0.4;
  const lastZ =
    chunk.startZ + usedOffsets[usedOffsets.length - 1] - half + 0.4;
  // Keep roughly the same density (~3 coins per train) when trimming.
  const trailCount = skipLastTrain ? 6 : 8;
  const step = (firstZ - lastZ) / Math.max(1, trailCount - 1);
  const x = LANE_X[lane.toString() as '-1' | '0' | '1'];
  const coins: CoinPos[] = [];
  for (let i = 0; i < trailCount; i++) {
    coins.push({
      key: `${chunk.id}-roof-coin-${i}`,
      lane,
      x,
      baseY: TRAIN_ROOF_COIN_Y,
      z: firstZ - i * step,
      phase: i * 0.5,
    });
  }
  return coins;
}

function laneX(lane: Lane) {
  return LANE_X[lane.toString() as '-1' | '0' | '1'];
}

type Props = {
  chunks: ChunkSpec[];
  collectedIds: ReadonlySet<string>;
  onCollect: (coinId: string) => void;
};

export function Coins({ chunks, collectedIds, onCollect }: Props) {
  const { camera } = useThree();
  const previousCameraZRef = useRef(camera.position.z);
  const collectedIdsRef = useRef(collectedIds);
  collectedIdsRef.current = collectedIds;
  const coins = useMemo(
    () => chunks.flatMap((chunk) => computeChunkCoins(chunk)),
    [chunks],
  );
  const visibleCoins = useMemo(
    () => coins.filter((coin) => !collectedIds.has(coin.key)),
    [coins, collectedIds],
  );
  const refs = useRef<(THREE.Group | null)[]>([]);
  refs.current = [];

  // Shared geometries/materials: one allocation, every coin reuses them.
  const ringGeom = useMemo(
    () => new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, COIN_SEGMENTS),
    [],
  );
  const ringMat = useMemo(
    () =>
      // Unlit material keeps the coin a constant bright yellow regardless of
      // its spin angle. With Lambert shading the disc face dipped toward grey
      // each rotation as it faced away from the directional lights.
      new THREE.MeshBasicMaterial({
        color: '#fde047',
      }),
    [],
  );
  const innerGeom = useMemo(
    () => new THREE.CylinderGeometry(COIN_RADIUS * 0.55, COIN_RADIUS * 0.55, COIN_THICKNESS + 0.005, COIN_SEGMENTS),
    [],
  );
  const innerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#f59e0b',
      }),
    [],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const spin = t * 3.5;
    const previousZ = previousCameraZRef.current;
    const currentZ = camera.position.z;
    previousCameraZRef.current = currentZ;
    for (let i = 0; i < refs.current.length; i++) {
      const g = refs.current[i];
      const c = visibleCoins[i];
      if (!g || !c) continue;
      g.rotation.y = spin + c.phase;
      g.position.y = c.baseY + Math.sin(t * 2 + c.phase) * 0.035;
    }
    for (const coin of visibleCoins) {
      if (collectedIdsRef.current.has(coin.key)) continue;
      const crossedCoin = previousZ >= coin.z && currentZ <= coin.z;
      const nearCoin = Math.abs(currentZ - coin.z) <= COIN_COLLECT_Z_WINDOW;
      const inLane = Math.abs(camera.position.x - laneX(coin.lane)) <= COIN_COLLECT_LANE_WINDOW;
      if ((crossedCoin || nearCoin) && inLane) {
        onCollect(coin.key);
      }
    }
  });

  return (
    <group>
      {visibleCoins.map((c, i) => (
        <group
          key={c.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[c.x, c.baseY, c.z]}
        >
          {/* Coin disc (cylinder rotated so its flat faces look toward ±z) */}
          <mesh rotation={[Math.PI / 2, 0, 0]} geometry={ringGeom} material={ringMat} />
          {/* Inner darker disc to add depth */}
          <mesh rotation={[Math.PI / 2, 0, 0]} geometry={innerGeom} material={innerMat} />
        </group>
      ))}
    </group>
  );
}

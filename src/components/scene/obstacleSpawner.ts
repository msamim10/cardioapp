import { CHUNK_LENGTH, LANES } from '@/lib/constants';
import type { Lane, ObstacleKind, ObstacleSpec } from '@/lib/types';

const SLOT_COUNT = 4;
const SLOT_PADDING = 2;

const KIND_WEIGHTS: Array<[ObstacleKind, number]> = [
  ['barrier', 0.5],
  ['overhead', 0.3],
  ['wall', 0.2],
];

function pickKind(rng: () => number): ObstacleKind {
  const r = rng();
  let acc = 0;
  for (const [kind, w] of KIND_WEIGHTS) {
    acc += w;
    if (r <= acc) return kind;
  }
  return 'barrier';
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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
 * Spawn obstacles for a chunk that runs from startZ down to startZ - CHUNK_LENGTH.
 *
 * Guarantees:
 *  - At every "slot" z-position, AT MOST 2 of the 3 lanes are blocked.
 *  - At least one lane is always passable (either empty, jumpable barrier,
 *    or duckable overhead).
 *  - At most 2 obstacles per slot (prevents the dead-end of 3 walls in a row).
 */
export function spawnObstaclesForChunk(startZ: number, seed: number): ObstacleSpec[] {
  const rng = mulberry32(seed >>> 0 || 1);
  const out: ObstacleSpec[] = [];
  const usableLen = CHUNK_LENGTH - SLOT_PADDING * 2;
  const slotSpacing = usableLen / SLOT_COUNT;

  for (let i = 0; i < SLOT_COUNT; i++) {
    const z = startZ - SLOT_PADDING - i * slotSpacing - slotSpacing / 2;
    const r = rng();
    let numObs = 0;
    if (r < 0.25) numObs = 0;
    else if (r < 0.8) numObs = 1;
    else numObs = 2;
    if (numObs === 0) continue;

    // Invariant: every slot must leave a lane the camera can ALWAYS reach in
    // one hop, regardless of which lane it's currently in. The center lane
    // (0) is the only lane adjacent to both edge lanes, so the rule is:
    //  - 1 obstacle: any lane is safe (the other two lanes are free)
    //  - 2 obstacles: must be lanes -1 and 1, leaving center free
    let lanes: Lane[];
    if (numObs === 2) {
      lanes = [-1, 1];
      // Shuffle in place so we sometimes place the "first" obstacle on the
      // right vs left (kind order matters).
      if (rng() < 0.5) lanes = [1, -1];
    } else {
      lanes = shuffle(LANES, rng);
    }

    const kinds: ObstacleKind[] = [];
    for (let k = 0; k < numObs; k++) kinds.push(pickKind(rng));

    for (let k = 0; k < numObs; k++) {
      out.push({
        id: `${seed}-${i}-${k}`,
        kind: kinds[k],
        lane: lanes[k],
        z,
      });
    }
  }

  return out;
}

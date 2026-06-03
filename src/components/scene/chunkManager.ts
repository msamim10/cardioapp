import { CHUNKS_AHEAD, CHUNKS_BEHIND, CHUNK_LENGTH } from '@/lib/constants';
import { roofRunForStartZ, trainGapObstacleSpec } from '@/lib/roofRun';
import type {
  ChunkSpec,
  Lane,
  ObstacleSpec,
  RoofRunRole,
  RoofRunVariant,
} from '@/lib/types';

/**
 * Computes the obstacle list and roofRun marker for a chunk that's being
 * (re)built. Roof-run chunks always suppress the normal spawner:
 *   - 'run' in the 'gap' variant gets a single trainGap that triggers a
 *     forward jump over the visible gap between train groups.
 *   - 'run' in the 'lane' variant gets NO obstacle - the forced lane
 *     change in AutoCamera (driven by the chunk's lane field) is what
 *     produces the sideways leap onto the next chunk's train.
 *   - 'entry' / 'exit' always get no obstacles.
 * Returns null when the chunk should fall through to the normal spawner.
 */
function buildRoofRunForChunk(
  startZ: number,
  seed: number,
): {
  obstacles: ObstacleSpec[];
  roofRun: { role: RoofRunRole; variant: RoofRunVariant; lane: Lane };
} | null {
  const roof = roofRunForStartZ(startZ);
  if (!roof) return null;
  const wantsGap = roof.role === 'run' && roof.variant === 'gap';
  return {
    obstacles: wantsGap ? [trainGapObstacleSpec(startZ, seed)] : [],
    roofRun: { role: roof.role, variant: roof.variant, lane: roof.lane },
  };
}

let chunkIdCounter = 0;
let seedCounter = 1;

export function nextChunkId(): string {
  chunkIdCounter += 1;
  return `chunk-${chunkIdCounter}`;
}

export function nextSeed(): number {
  seedCounter = (seedCounter * 1103515245 + 12345) & 0x7fffffff;
  return seedCounter;
}

/** Builds the very first ring of chunks, starting just in front of the camera. */
export function createInitialChunks(
  spawnObstacles: (startZ: number, seed: number) => ChunkSpec['obstacles'] = () => [],
): ChunkSpec[] {
  chunkIdCounter = 0;
  seedCounter = 1;
  const chunks: ChunkSpec[] = [];
  // First chunk's leading edge sits a little ahead of the camera (z = 4)
  // so we don't start inside geometry. Subsequent chunks tile further out.
  for (let i = -CHUNKS_BEHIND; i < CHUNKS_AHEAD; i++) {
    const startZ = -i * CHUNK_LENGTH + 4;
    const seed = nextSeed();
    const roofChunk = buildRoofRunForChunk(startZ, seed);
    chunks.push({
      id: nextChunkId(),
      seed,
      startZ,
      length: CHUNK_LENGTH,
      // Give the player a brief grace period: no obstacles in the very first
      // chunk in front of the camera (i === 0) or behind it.
      obstacles: roofChunk
        ? roofChunk.obstacles
        : i <= 0
        ? []
        : spawnObstacles(startZ, seed),
      roofRun: roofChunk?.roofRun,
    });
  }
  return chunks;
}

/**
 * Recycles the chunk that's furthest behind the camera to a new position
 * just past the farthest currently-existing chunk.
 */
export function recycleFarthestBehind(
  chunks: ChunkSpec[],
  cameraZ: number,
  spawnObstacles: (startZ: number, seed: number) => ChunkSpec['obstacles'],
): { chunks: ChunkSpec[]; recycled: boolean } {
  // Sort hint: each chunk extends from startZ (near camera) to startZ - length (far).
  // A chunk is behind the camera when its FAR edge is greater than cameraZ + buffer.
  const buffer = CHUNK_LENGTH * CHUNKS_BEHIND;
  let recycleIdx = -1;
  for (let i = 0; i < chunks.length; i++) {
    const farEdge = chunks[i].startZ - chunks[i].length; // more negative
    if (farEdge > cameraZ + buffer) {
      // Chunk has fallen behind the camera (camera is more negative than farEdge - buffer).
      // Wait - in our coord system, camera moves toward NEGATIVE z. So camera < farEdge
      // means camera has not yet passed the chunk. We want to recycle when camera is
      // past (i.e. cameraZ < chunk.farEdge - something). Recompute below.
    }
    // Proper check: chunk is behind camera when chunk.startZ > cameraZ + buffer
    // (its NEAR edge is well behind the camera in the +z direction).
    if (chunks[i].startZ > cameraZ + buffer) {
      if (recycleIdx === -1 || chunks[i].startZ > chunks[recycleIdx].startZ) {
        recycleIdx = i;
      }
    }
  }
  if (recycleIdx === -1) {
    return { chunks, recycled: false };
  }

  // Find the farthest-ahead (most negative startZ) chunk.
  let farthestIdx = 0;
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].startZ < chunks[farthestIdx].startZ) farthestIdx = i;
  }

  const newStartZ = chunks[farthestIdx].startZ - CHUNK_LENGTH;
  const seed = nextSeed();
  const next = chunks.slice();
  const previous = next[recycleIdx];
  const roofChunk = buildRoofRunForChunk(newStartZ, seed);
  // When recycling INTO a roof-run chunk we always rebuild from the roof
  // template. When recycling OUT of a roof-run chunk (previous.roofRun set)
  // we must re-spawn instead of shifting the old trainGap into a normal
  // chunk. Only "normal → normal" can reuse + shift the previous obstacles.
  let obstacles: ObstacleSpec[];
  if (roofChunk) {
    obstacles = roofChunk.obstacles;
  } else if (previous.roofRun || previous.obstacles.length === 0) {
    obstacles = spawnObstacles(newStartZ, seed);
  } else {
    obstacles = previous.obstacles.map((obstacle) => ({
      ...obstacle,
      z: newStartZ - (previous.startZ - obstacle.z),
    }));
  }
  next[recycleIdx] = {
    ...next[recycleIdx],
    id: nextChunkId(),
    seed,
    startZ: newStartZ,
    obstacles,
    roofRun: roofChunk?.roofRun,
  };
  return { chunks: next, recycled: true };
}

import { useFrame, useThree } from '@react-three/fiber/native';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as THREE from 'three';
import { theme } from '@/lib/theme';
import {
  CAMERA_HEIGHT,
  CAMERA_LANE,
  CAMERA_LOOK_AHEAD,
  CAMERA_LOOK_Y,
  CAMERA_START_Z,
  CHUNK_LENGTH,
  CHUNKS_BEHIND_CAMERA,
  GAMEPLAY_MODEL_ASSETS,
  LANES,
  LANE_X,
  RUN_SPEED,
  TRAIN_CHANCE,
  TUNNEL_CHANCE,
  VISIBLE_CHUNKS,
  type ChunkKind,
  type GameplayChunk,
  type Lane,
} from './gameplayConstants';
import { GameplayCanvas } from './GameplayCanvas';
import { preloadGlbModel } from './GlbModel';
import { RoadChunk } from './RoadChunk';

type Props = {
  paused: boolean;
  resetKey: number;
  onDistanceChange: (distanceMeters: number) => void;
};

export function EndlessRoadScene({ paused, resetKey, onDistanceChange }: Props) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    Promise.all(GAMEPLAY_MODEL_ASSETS.map((asset) => preloadGlbModel(asset)))
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Could not load models.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.root}>
      <GameplayCanvas>
        {ready && (
          <RunnerWorld
            paused={paused}
            resetKey={resetKey}
            onDistanceChange={onDistanceChange}
          />
        )}
      </GameplayCanvas>

      {!ready && (
        <View style={styles.loadingOverlay} pointerEvents="auto">
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingTitle}>LOADING TRACK</Text>
          <Text style={styles.loadingText}>
            {loadError ?? 'Preparing road, tunnel, and train assets.'}
          </Text>
        </View>
      )}
    </View>
  );
}

function RunnerWorld({ paused, resetKey, onDistanceChange }: Props) {
  const { camera } = useThree();
  const [chunks, setChunks] = useState<GameplayChunk[]>(createInitialChunks);
  const chunksRef = useRef(chunks);
  const lookAtTargetRef = useRef(new THREE.Vector3());
  const lastDistanceRef = useRef(-1);

  const resetWorld = useCallback(() => {
    const initial = createInitialChunks();
    chunksRef.current = initial;
    setChunks(initial);
    lastDistanceRef.current = -1;

    camera.position.set(LANE_X[CAMERA_LANE], CAMERA_HEIGHT, CAMERA_START_Z);
    lookAtTargetRef.current.set(
      LANE_X[CAMERA_LANE],
      CAMERA_LOOK_Y,
      CAMERA_START_Z - CAMERA_LOOK_AHEAD,
    );
    camera.lookAt(lookAtTargetRef.current);
    onDistanceChange(0);
  }, [camera, onDistanceChange]);

  useEffect(() => {
    resetWorld();
  }, [resetKey, resetWorld]);

  useFrame((_, frameDelta) => {
    if (paused) return;

    const delta = Math.min(frameDelta, 1 / 30);
    camera.position.z -= RUN_SPEED * delta;
    camera.position.x = THREE.MathUtils.damp(
      camera.position.x,
      LANE_X[CAMERA_LANE],
      9,
      delta,
    );
    camera.position.y = CAMERA_HEIGHT;

    lookAtTargetRef.current.set(
      camera.position.x,
      CAMERA_LOOK_Y,
      camera.position.z - CAMERA_LOOK_AHEAD,
    );
    camera.lookAt(lookAtTargetRef.current);

    const distance = Math.max(0, Math.floor(CAMERA_START_Z - camera.position.z));
    if (distance !== lastDistanceRef.current) {
      lastDistanceRef.current = distance;
      onDistanceChange(distance);
    }

    recycleChunks(camera.position.z, chunksRef, setChunks);
  });

  return (
    <>
      <ambientLight intensity={0.72} />
      <hemisphereLight args={['#d8f3ff', '#57432b', 1.1]} />
      <directionalLight position={[6, 11, 5]} intensity={1.35} />
      {chunks.map((chunk) => (
        <RoadChunk key={chunk.id} chunk={chunk} />
      ))}
    </>
  );
}

function createInitialChunks(): GameplayChunk[] {
  return Array.from({ length: VISIBLE_CHUNKS }, (_, index) =>
    createChunk(index, -index * CHUNK_LENGTH),
  );
}

function recycleChunks(
  cameraZ: number,
  chunksRef: MutableRefObject<GameplayChunk[]>,
  setChunks: (chunks: GameplayChunk[]) => void,
) {
  let nextChunks = chunksRef.current;
  let changed = false;

  while (true) {
    const behindIndex = nextChunks.findIndex(
      (chunk) =>
        chunk.z - cameraZ > CHUNK_LENGTH * (CHUNKS_BEHIND_CAMERA + 0.65),
    );

    if (behindIndex === -1) break;

    const farthestZ = Math.min(...nextChunks.map((chunk) => chunk.z));
    const nextSequence = Math.max(...nextChunks.map((chunk) => chunk.sequence)) + 1;
    const recycled = createChunk(nextSequence, farthestZ - CHUNK_LENGTH);

    nextChunks = nextChunks.map((chunk, index) =>
      index === behindIndex ? recycled : chunk,
    );
    changed = true;
  }

  if (changed) {
    chunksRef.current = nextChunks;
    setChunks(nextChunks);
  }
}

function createChunk(sequence: number, z: number): GameplayChunk {
  const kind = pickChunkKind(sequence);
  const trainLane = pickTrainLane(sequence, kind);

  return {
    id: `chunk-${sequence}`,
    sequence,
    z,
    kind,
    trainLane,
    trainOffsetZ: -CHUNK_LENGTH * 0.08,
  };
}

function pickChunkKind(sequence: number): ChunkKind {
  if (sequence < 2) return 'road';
  return seededRandom(sequence * 11.73) < TUNNEL_CHANCE ? 'tunnel' : 'road';
}

function pickTrainLane(sequence: number, kind: ChunkKind): Lane | null {
  if (sequence < 3 || kind === 'tunnel') return null;
  if (seededRandom(sequence * 19.91) > TRAIN_CHANCE) return null;

  const laneIndex = Math.floor(seededRandom(sequence * 31.17) * LANES.length);
  return LANES[laneIndex] ?? 0;
}

function seededRandom(seed: number): number {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.bg,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: theme.colors.bg,
    paddingHorizontal: theme.spacing.xl,
  },
  loadingTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  loadingText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});

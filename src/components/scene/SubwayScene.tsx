import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import * as THREE from 'three';
import {
  CAMERA_EYE_HEIGHT,
  FOG_COLOR,
  FOG_FAR,
  FOG_NEAR,
  SKY_COLOR,
} from '@/lib/constants';
import type { ActionCue, ChunkSpec } from '@/lib/types';
import { AirplaneFlyby } from './AirplaneFlyby';
import { AutoCamera } from './AutoCamera';
import { CartoonClouds } from './CartoonClouds';
import { Coins } from './Coins';
import { Lighting } from './Lighting';
import { Track } from './Track';
import { ObstaclesField } from './ObstaclesField';
import { ForwardRunner } from './ForwardRunner';
import { TrainRoofRun } from './TrainRoofRun';
import { createInitialChunks } from './chunkManager';
import { spawnObstaclesForChunk } from './obstacleSpawner';

type Props = {
  paused?: boolean;
  collectedCoinIds: ReadonlySet<string>;
  onCoinCollect: (coinId: string) => void;
  onCueChange: (cue: ActionCue) => void;
};

export function SubwayScene({
  paused = false,
  collectedCoinIds,
  onCoinCollect,
  onCueChange,
}: Props) {
  const spawnObstacles = useCallback(spawnObstaclesForChunk, []);
  const [chunks, setChunks] = useState<ChunkSpec[]>(() =>
    createInitialChunks(spawnObstaclesForChunk),
  );
  const chunksRef = useRef(chunks);
  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  const handleCreated = useMemo(
    () =>
      ({
        scene,
        gl,
        camera,
      }: {
        scene: THREE.Scene;
        gl: THREE.WebGLRenderer;
        camera: THREE.Camera;
      }) => {
        scene.background = new THREE.Color(SKY_COLOR);
        scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
        gl.setClearColor(SKY_COLOR);
        camera.position.set(0, CAMERA_EYE_HEIGHT, 0);
        camera.lookAt(0, CAMERA_EYE_HEIGHT, -10);
      },
    [],
  );

  return (
    <View style={styles.container} pointerEvents="none">
      <Canvas
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{
          position: [0, CAMERA_EYE_HEIGHT, 0],
          fov: 70,
          near: 0.1,
          far: 120,
        }}
        onCreated={handleCreated}
        frameloop={paused ? 'demand' : 'always'}
      >
        <Lighting />
        <CartoonClouds />
        <AirplaneFlyby />
        <Track chunks={chunks} />
        <ObstaclesField chunks={chunks} />
        <TrainRoofRun chunks={chunks} />
        <Coins chunks={chunks} collectedIds={collectedCoinIds} onCollect={onCoinCollect} />
        <ForwardRunner
          chunks={chunks}
          onChunksChange={setChunks}
          spawnObstacles={spawnObstacles}
          paused={paused}
        />
        <AutoCamera chunksRef={chunksRef} paused={paused} onCueChange={onCueChange} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SKY_COLOR,
  },
});

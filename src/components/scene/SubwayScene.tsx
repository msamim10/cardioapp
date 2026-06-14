import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import * as THREE from 'three';
import {
  CAMERA_RIG,
  FOG_COLOR,
  FOG_FAR,
  FOG_NEAR,
  SKY_COLOR,
} from '@/lib/constants';
import type { ActionCue, ChunkSpec, RunnerPose, WorkoutSceneVariant } from '@/lib/types';
import { AirplaneFlyby } from './AirplaneFlyby';
import { AutoRunner } from './AutoRunner';
import { CameraRig } from './CameraRig';
import { CartoonClouds } from './CartoonClouds';
import { Coins } from './Coins';
import { GuardCharacter } from './GuardCharacter';
import { Lighting } from './Lighting';
import { RunnerCharacter } from './RunnerCharacter';
import { Track } from './Track';
import { ObstaclesField } from './ObstaclesField';
import { ForwardRunner } from './ForwardRunner';
import { TrainRoofRun } from './TrainRoofRun';
import { createInitialChunks } from './chunkManager';
import { spawnObstaclesForChunk } from './obstacleSpawner';

type Props = {
  variant?: WorkoutSceneVariant;
  paused?: boolean;
  collectedCoinIds: ReadonlySet<string>;
  onCoinCollect: (coinId: string) => void;
  onCueChange: (cue: ActionCue) => void;
};

export function SubwayScene({
  variant = 'city-builder',
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

  // The logical player: AutoRunner steers it, ForwardRunner advances it,
  // CameraRig chases it, Coins collect against it.
  const runnerRef = useRef<THREE.Group>(null);
  const poseRef = useRef<RunnerPose>({ runPhase: 0, jumpT: 0, duckT: 0, lean: 0 });

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
        camera.position.set(0, CAMERA_RIG.height, CAMERA_RIG.back);
        camera.lookAt(0, CAMERA_RIG.lookHeight, -CAMERA_RIG.lookAhead);
      },
    [],
  );

  return (
    <View style={styles.container} pointerEvents="none">
      <Canvas
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{
          position: [0, CAMERA_RIG.height, CAMERA_RIG.back],
          fov: 62,
          near: 0.1,
          far: 150,
        }}
        onCreated={handleCreated}
        frameloop={paused ? 'demand' : 'always'}
      >
        <Lighting />
        <CartoonClouds />
        <AirplaneFlyby />
        <Track chunks={chunks} variant={variant} />
        <ObstaclesField chunks={chunks} variant={variant} />
        <TrainRoofRun chunks={chunks} />
        <Coins
          runnerRef={runnerRef}
          chunks={chunks}
          collectedIds={collectedCoinIds}
          onCollect={onCoinCollect}
          variant={variant}
        />

        {/* The visible player */}
        <group ref={runnerRef}>
          <RunnerCharacter poseRef={poseRef} />
        </group>
        {/* The inspector chasing right behind (between runner and camera) */}
        <GuardCharacter
          runnerRef={runnerRef}
          poseRef={poseRef}
          chunksRef={chunksRef}
          paused={paused}
          variant={variant}
        />

        <ForwardRunner
          runnerRef={runnerRef}
          chunks={chunks}
          onChunksChange={setChunks}
          spawnObstacles={spawnObstacles}
          paused={paused}
        />
        <AutoRunner
          runnerRef={runnerRef}
          poseRef={poseRef}
          chunksRef={chunksRef}
          paused={paused}
          variant={variant}
          onCueChange={onCueChange}
        />
        {/* Mounted last so it follows AFTER the runner moved this frame */}
        <CameraRig runnerRef={runnerRef} />
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

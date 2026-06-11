import { Canvas } from '@react-three/fiber/native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import * as THREE from 'three';
import {
  CAMERA_HEIGHT,
  CAMERA_START_Z,
  FOG_COLOR,
  FOG_FAR,
  FOG_NEAR,
  SKY_COLOR,
} from './gameplayConstants';

type Props = {
  children: ReactNode;
};

export function GameplayCanvas({ children }: Props) {
  return (
    <Canvas
      style={styles.canvas}
      camera={{
        position: [0, CAMERA_HEIGHT, CAMERA_START_Z],
        fov: 64,
        near: 0.1,
        far: 180,
      }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color(SKY_COLOR);
        scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
      }}
    >
      {children}
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: {
    ...StyleSheet.absoluteFillObject,
  },
});

import { Asset } from 'expo-asset';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type Vec3 = [number, number, number];

type Props = {
  assetModule: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
  normalize?: boolean;
};

const sourceCache = new Map<number, Promise<THREE.Group>>();

export function preloadGlbModel(assetModule: number): Promise<THREE.Group> {
  const cached = sourceCache.get(assetModule);
  if (cached) return cached;

  const loadPromise = Asset.loadAsync(assetModule).then(([asset]) => {
    const uri = asset.localUri ?? asset.uri;
    if (!uri) throw new Error('GLB asset did not resolve to a local URI.');

    return new Promise<THREE.Group>((resolve, reject) => {
      ensureNavigatorUserAgent();
      const loader = new GLTFLoader();
      loader.load(
        uri,
        (gltf) => {
          const scene = gltf.scene;
          prepareScene(scene);
          resolve(scene);
        },
        undefined,
        reject,
      );
    });
  });

  sourceCache.set(assetModule, loadPromise);
  return loadPromise;
}

export function GlbModel({
  assetModule,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  normalize = true,
}: Props) {
  const [source, setSource] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    preloadGlbModel(assetModule)
      .then((model) => {
        if (!cancelled) setSource(model);
      })
      .catch((error) => {
        console.warn('Failed to load gameplay GLB', error);
      });

    return () => {
      cancelled = true;
    };
  }, [assetModule]);

  const instance = useMemo(() => {
    if (!source) return null;
    return cloneScene(source, normalize);
  }, [normalize, source]);

  if (!instance) return null;

  const resolvedScale: Vec3 =
    typeof scale === 'number' ? [scale, scale, scale] : scale;

  return (
    <group position={position} rotation={rotation} scale={resolvedScale}>
      <primitive object={instance} />
    </group>
  );
}

function ensureNavigatorUserAgent() {
  const globalWithNavigator = globalThis as {
    navigator?: { userAgent?: string };
  };
  const userAgent = globalWithNavigator.navigator?.userAgent;
  if (typeof userAgent === 'string') return;

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      ...(globalWithNavigator.navigator ?? {}),
      userAgent: 'ReactNative',
    },
  });
}

function cloneScene(source: THREE.Group, normalize: boolean): THREE.Group {
  const instance = source.clone(true);
  prepareScene(instance);

  if (normalize) {
    const box = new THREE.Box3().setFromObject(instance);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      instance.position.x -= center.x;
      instance.position.y -= box.min.y;
      instance.position.z -= center.z;
    }
  }

  return instance;
}

function prepareScene(scene: THREE.Object3D) {
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!material) return;
      material.side = THREE.FrontSide;
      material.needsUpdate = true;
    });
  });
}

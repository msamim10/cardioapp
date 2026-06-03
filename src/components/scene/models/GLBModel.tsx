import { useEffect, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { Asset } from 'expo-asset';
import ExpoTextureLoader from 'expo-three/build/TextureLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type Vec3 = [number, number, number];

type Props = {
  /** Result of `require('../../../assets/models/foo.glb')` */
  assetModule: number;
  /** Multiplier scale (applied AFTER fitHeight if both given). */
  scale?: number | Vec3;
  position?: Vec3;
  rotation?: Vec3;
  /** Override material color for all meshes. */
  tint?: string;
  /** Optional texture asset to apply when embedded GLB textures do not load on native. */
  textureAssetModule?: number;
  /**
   * Auto-scale so model bounding box height equals this value (in world units).
   * Solves the "Quaternius is 1m / Poly Pizza is 100x" problem.
   */
  fitHeight?: number;
  /** Auto-scale so model bounding box width (world X) equals this value. */
  fitWidth?: number;
  /** Auto-scale so model bounding box depth (world Z) equals this value. */
  fitDepth?: number;
  /** Place model so its bottom rests at y=0 of its local frame. Default true. */
  groundAlign?: boolean;
  /** Some downloaded packs are Z-up. Convert them to Three's Y-up world. */
  sourceUp?: 'y' | 'z';
  /** Rendered while loading or if loading fails. */
  fallback?: ReactNode;
};

const loader = new GLTFLoader();
const textureLoader = new ExpoTextureLoader();

function ensureNavigatorUserAgent() {
  const globalWithNavigator = globalThis as typeof globalThis & {
    navigator?: Navigator & { userAgent?: string };
  };
  if (!globalWithNavigator.navigator) {
    globalWithNavigator.navigator = { userAgent: 'ReactNative' } as Navigator & {
      userAgent?: string;
    };
    return;
  }
  if (!globalWithNavigator.navigator.userAgent) {
    globalWithNavigator.navigator.userAgent = 'ReactNative';
  }
}

// Cache pristine loaded scenes so each GLB is only fetched and parsed once,
// no matter how many chunks reference it.
const modelCache = new Map<number, THREE.Group>();
const textureCache = new Map<number, THREE.Texture>();
// Track in-flight loads so concurrent callers share one fetch.
const pendingLoads = new Map<number, Promise<THREE.Group | null>>();
const pendingTextures = new Map<number, Promise<THREE.Texture | null>>();

/** Preload a GLB into the cache so the first render is instant. */
export function preloadModel(assetModule: number): Promise<void> {
  return loadModel(assetModule).then(() => undefined);
}

async function loadModel(assetModule: number): Promise<THREE.Group | null> {
  const cached = modelCache.get(assetModule);
  if (cached) return cached;
  const pending = pendingLoads.get(assetModule);
  if (pending) return pending;
  const p = (async () => {
    try {
      const asset = Asset.fromModule(assetModule);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (!uri) {
        console.warn('[GLBModel] no URI for asset', assetModule);
        return null;
      }
      ensureNavigatorUserAgent();
      const group = await new Promise<THREE.Group | null>((resolve) => {
        loader.load(
          uri,
          (gltf) => resolve(gltf.scene),
          undefined,
          (err) => {
            console.warn('[GLBModel] load failed', assetModule, err);
            resolve(null);
          },
        );
      });
      if (group) {
        modelCache.set(assetModule, group);
        // Log raw bbox so we can sanity-check sizes from device logs.
        const box = new THREE.Box3().setFromObject(group);
        const size = new THREE.Vector3();
        box.getSize(size);
        console.log(
          `[GLBModel] loaded ${assetModule} bbox`,
          size.x.toFixed(2), 'x', size.y.toFixed(2), 'x', size.z.toFixed(2),
        );
      }
      return group;
    } catch (err) {
      console.warn('[GLBModel] asset error', assetModule, err);
      return null;
    } finally {
      pendingLoads.delete(assetModule);
    }
  })();
  pendingLoads.set(assetModule, p);
  return p;
}

async function loadTexture(assetModule: number): Promise<THREE.Texture | null> {
  const cached = textureCache.get(assetModule);
  if (cached) return cached;
  const pending = pendingTextures.get(assetModule);
  if (pending) return pending;
  const p = new Promise<THREE.Texture | null>((resolve) => {
    try {
      textureLoader.load(
        assetModule,
        (texture) => {
          texture.flipY = false;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          textureCache.set(assetModule, texture);
          resolve(texture);
        },
        undefined,
        (err) => {
          console.warn('[GLBModel] texture load failed', assetModule, err);
          resolve(null);
        },
      );
    } catch (err) {
      console.warn('[GLBModel] texture asset error', assetModule, err);
      resolve(null);
    }
  }).finally(() => {
    pendingTextures.delete(assetModule);
  });
  pendingTextures.set(assetModule, p);
  return p;
}

function cloneMaterialWithMods(
  material: THREE.Material,
  opts: { tint?: string; texture?: THREE.Texture },
) {
  const cloned = material.clone() as THREE.Material & {
    color?: THREE.Color;
    map?: THREE.Texture | null;
    metalness?: number;
    roughness?: number;
  };
  if (opts.tint && cloned.color) {
    cloned.color = new THREE.Color(opts.tint);
  }
  if (opts.texture && 'map' in cloned) {
    cloned.map = opts.texture;
    if (cloned.color) cloned.color = new THREE.Color(0xffffff);
    if (typeof cloned.metalness === 'number') cloned.metalness = 0;
    if (typeof cloned.roughness === 'number') cloned.roughness = 1;
  }
  cloned.needsUpdate = true;
  return cloned;
}

function applyMods(
  root: THREE.Group,
  opts: {
    fitHeight?: number;
    fitWidth?: number;
    fitDepth?: number;
    groundAlign: boolean;
    tint?: string;
    texture?: THREE.Texture;
    sourceUp: 'y' | 'z';
  },
) {
  if (opts.sourceUp === 'z') {
    // Poly Pizza city assets store vertical height on Z. Rotate the imported
    // root before bbox fitting so "height" becomes world Y.
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
  }

  if (opts.tint || opts.texture) {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((material) => cloneMaterialWithMods(material, opts))
          : cloneMaterialWithMods(mesh.material, opts);
      }
    });
  }

  let box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const fitTarget = opts.fitWidth ?? opts.fitDepth ?? opts.fitHeight;
  const fitSource =
    opts.fitWidth !== undefined ? size.x : opts.fitDepth !== undefined ? size.z : size.y;
  if (fitTarget !== undefined && fitSource > 0) {
    const s = fitTarget / fitSource;
    root.scale.multiplyScalar(s);
    box = new THREE.Box3().setFromObject(root);
  }
  if (opts.groundAlign) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;
  }
}

function makeSceneInstance(
  source: THREE.Group,
  opts: {
    fitHeight?: number;
    fitWidth?: number;
    fitDepth?: number;
    groundAlign: boolean;
    tint?: string;
    texture?: THREE.Texture;
    sourceUp: 'y' | 'z';
  },
): THREE.Group {
  const root = source.clone(true);
  applyMods(root, opts);
  return root;
}

export function GLBModel({
  assetModule,
  scale = 1,
  position,
  rotation,
  tint,
  textureAssetModule,
  fitHeight,
  fitWidth,
  fitDepth,
  groundAlign = true,
  sourceUp = 'y',
  fallback = null,
}: Props) {
  const [scene, setScene] = useState<THREE.Group | null>(() => {
    const cached = modelCache.get(assetModule);
    if (!cached) return null;
    const texture = textureAssetModule ? textureCache.get(textureAssetModule) : undefined;
    if (textureAssetModule && !texture) return null;
    return makeSceneInstance(cached, {
      fitHeight,
      fitWidth,
      fitDepth,
      groundAlign,
      tint,
      texture,
      sourceUp,
    });
  });

  useEffect(() => {
    if (scene) return;
    let cancelled = false;
    (async () => {
      const [source, texture] = await Promise.all([
        loadModel(assetModule),
        textureAssetModule ? loadTexture(textureAssetModule) : Promise.resolve(undefined),
      ]);
      if (cancelled || !source) return;
      setScene(
        makeSceneInstance(source, {
          fitHeight,
          fitWidth,
          fitDepth,
          groundAlign,
          tint,
          texture: texture ?? undefined,
          sourceUp,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [assetModule, fitDepth, fitHeight, fitWidth, groundAlign, scene, sourceUp, textureAssetModule, tint]);

  if (!scene) return <>{fallback}</>;
  const scaleArr: Vec3 =
    typeof scale === 'number' ? [scale, scale, scale] : scale;
  // World position/rotation/scale live on the wrapper group so the scene's
  // OWN position (set by applyMods for ground-align + centering) survives.
  return (
    <group position={position} rotation={rotation} scale={scaleArr}>
      <primitive object={scene} />
    </group>
  );
}

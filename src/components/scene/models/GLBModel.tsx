import { Asset } from 'expo-asset';
import { loadTextureAsync } from 'expo-three';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type Vec3 = [number, number, number];

type Props = {
  assetModule: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3 | number;
  fitWidth?: number;
  fitHeight?: number;
  fitDepth?: number;
  groundAlign?: boolean;
  fallback?: ReactNode;
  onLoaded?: () => void;
  /** Solid colour override. When set, the model is flat-shaded in this colour. */
  tint?: string;
  /**
   * Shared colour-atlas asset module. When provided, the texture is applied
   * as the material map (using the model's UVs) so the model keeps its
   * intended colours even though the embedded texture was stripped.
   */
  atlasModule?: number;
};

const modelCache = new Map<number, THREE.Group>();
const pendingLoads = new Map<number, Promise<THREE.Group | null>>();

const textureCache = new Map<number, THREE.Texture>();
const pendingTextures = new Map<number, Promise<THREE.Texture | null>>();

export function preloadGlbModel(assetModule: number): Promise<void> {
  return loadModel(assetModule).then(() => undefined);
}

async function loadModel(assetModule: number): Promise<THREE.Group | null> {
  const cached = modelCache.get(assetModule);
  if (cached) return cached;

  const pending = pendingLoads.get(assetModule);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const asset = Asset.fromModule(assetModule);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (!uri) return null;

      const loader = new GLTFLoader();
      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        loader.load(uri, resolve, undefined, reject);
      });
      normalizeScene(gltf.scene);
      modelCache.set(assetModule, gltf.scene);
      return gltf.scene;
    } catch (err) {
      console.warn('[GLBModel] load failed', assetModule, err);
      return null;
    } finally {
      pendingLoads.delete(assetModule);
    }
  })();

  pendingLoads.set(assetModule, promise);
  return promise;
}

async function loadAtlas(atlasModule: number): Promise<THREE.Texture | null> {
  const cached = textureCache.get(atlasModule);
  if (cached) return cached;

  const pending = pendingTextures.get(atlasModule);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const texture: THREE.Texture = await loadTextureAsync({ asset: atlasModule });
      // glTF UVs assume a top-left origin (flipY = false). Nearest filtering
      // keeps the flat palette cells crisp instead of bleeding between colours.
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      textureCache.set(atlasModule, texture);
      return texture;
    } catch (err) {
      console.warn('[GLBModel] atlas load failed', atlasModule, err);
      return null;
    } finally {
      pendingTextures.delete(atlasModule);
    }
  })();

  pendingTextures.set(atlasModule, promise);
  return promise;
}

function normalizeScene(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

function cloneGroup(group: THREE.Group): THREE.Group {
  return group.clone(true);
}

function applyMaterials(object: THREE.Group, atlas: THREE.Texture | null, tint?: string) {
  object.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Replace whatever PBR material the loader produced with a Lambert
    // material that plays nicely with the scene's simple lighting. When an
    // atlas is supplied we keep the colour from the texture; otherwise we
    // fall back to a tint or a neutral grey so the shape stays visible.
    const material = new THREE.MeshLambertMaterial({
      color: atlas && !tint ? 0xffffff : new THREE.Color(tint ?? '#c2c8d0'),
      map: tint ? null : atlas,
    });
    mesh.material = material;
  });
}

function fitAndAlign(
  object: THREE.Group,
  opts: Pick<Props, 'fitWidth' | 'fitHeight' | 'fitDepth' | 'groundAlign'>,
) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const targets = [
    opts.fitWidth && size.x > 0 ? opts.fitWidth / size.x : null,
    opts.fitHeight && size.y > 0 ? opts.fitHeight / size.y : null,
    opts.fitDepth && size.z > 0 ? opts.fitDepth / size.z : null,
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (targets.length) {
    object.scale.multiplyScalar(Math.min(...targets));
  }

  if (opts.groundAlign ?? true) {
    const alignedBox = new THREE.Box3().setFromObject(object);
    object.position.y -= alignedBox.min.y;
  }
}

export function GLBModel({
  assetModule,
  position,
  rotation,
  scale = 1,
  fitWidth,
  fitHeight,
  fitDepth,
  groundAlign = true,
  fallback = null,
  onLoaded,
  tint,
  atlasModule,
}: Props) {
  const [source, setSource] = useState<THREE.Group | null | undefined>(() =>
    modelCache.get(assetModule),
  );
  const [atlas, setAtlas] = useState<THREE.Texture | null>(() =>
    atlasModule != null ? textureCache.get(atlasModule) ?? null : null,
  );

  useEffect(() => {
    let cancelled = false;
    loadModel(assetModule).then((model) => {
      if (!cancelled) {
        setSource(model);
        if (model) onLoaded?.();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [assetModule, onLoaded]);

  useEffect(() => {
    if (atlasModule == null) return;
    let cancelled = false;
    loadAtlas(atlasModule).then((texture) => {
      if (!cancelled) setAtlas(texture);
    });
    return () => {
      cancelled = true;
    };
  }, [atlasModule]);

  const object = useMemo(() => {
    if (!source) return null;
    // Wait for the atlas before building so we don't flash an untextured
    // version first (only matters when an atlas was requested).
    if (atlasModule != null && !atlas && !tint) return null;
    const cloned = cloneGroup(source);
    applyMaterials(cloned, atlas, tint);
    fitAndAlign(cloned, { fitWidth, fitHeight, fitDepth, groundAlign });
    if (typeof scale === 'number') {
      cloned.scale.multiplyScalar(scale);
    } else {
      cloned.scale.multiply(new THREE.Vector3(scale[0], scale[1], scale[2]));
    }
    return cloned;
  }, [source, atlas, atlasModule, fitWidth, fitHeight, fitDepth, groundAlign, scale, tint]);

  if (!object) return <>{fallback}</>;
  return <primitive object={object} position={position} rotation={rotation} />;
}

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const jobs = [
  {
    path: 'assets/models/gameplay/Road.mobile.glb',
    color: [0.72, 0.74, 0.72, 1],
  },
  {
    path: 'assets/models/gameplay/Tunnel.mobile.glb',
    color: [0.82, 0.84, 0.82, 1],
  },
  {
    path: 'assets/models/gameplay/Train.mobile.glb',
    color: [0.86, 0.16, 0.12, 1],
  },
];

for (const job of jobs) {
  const doc = await io.read(job.path);
  const root = doc.getRoot();

  for (const material of root.listMaterials()) {
    material
      .setBaseColorFactor(job.color)
      .setBaseColorTexture(null)
      .setMetallicRoughnessTexture(null)
      .setNormalTexture(null)
      .setOcclusionTexture(null)
      .setEmissiveTexture(null)
      .setMetallicFactor(0)
      .setRoughnessFactor(0.92);
  }

  for (const texture of root.listTextures()) {
    texture.dispose();
  }

  await doc.transform(prune());
  await io.write(job.path, doc);
  console.log(`Stripped textures from ${job.path}`);
}

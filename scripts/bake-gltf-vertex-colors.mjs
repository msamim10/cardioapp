import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import sharp from 'sharp';

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/bake-gltf-vertex-colors.mjs <input.glb> <output.glb>');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inputPath);
const root = doc.getRoot();

const textures = root.listTextures();
if (textures.length === 0) {
  throw new Error(`No texture found in ${inputPath}`);
}

const texture = textures[0];
const image = texture.getImage();
if (!image) {
  throw new Error(`Texture has no embedded image in ${inputPath}`);
}

const { data, info } = await sharp(image)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    const uv = primitive.getAttribute('TEXCOORD_0');

    if (!position || !uv) continue;

    const count = position.getCount();
    const uvArray = uv.getArray();
    const colors = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      const u = wrap01(uvArray[index * 2]);
      const v = wrap01(uvArray[index * 2 + 1]);
      const x = Math.min(info.width - 1, Math.max(0, Math.round(u * (info.width - 1))));
      const y = Math.min(info.height - 1, Math.max(0, Math.round(v * (info.height - 1))));
      const offset = (y * info.width + x) * info.channels;

      colors[index * 3] = srgbToLinear(data[offset] / 255);
      colors[index * 3 + 1] = srgbToLinear(data[offset + 1] / 255);
      colors[index * 3 + 2] = srgbToLinear(data[offset + 2] / 255);
    }

    const colorAccessor = doc
      .createAccessor(`${mesh.getName() || 'mesh'}_COLOR_0`)
      .setType('VEC3')
      .setArray(colors);

    primitive.setAttribute('COLOR_0', colorAccessor);
    primitive.setAttribute('TEXCOORD_0', null);
  }
}

for (const material of root.listMaterials()) {
  material
    .setBaseColorTexture(null)
    .setMetallicRoughnessTexture(null)
    .setNormalTexture(null)
    .setOcclusionTexture(null)
    .setEmissiveTexture(null)
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.82);
}

for (const item of root.listTextures()) {
  item.dispose();
}

await doc.transform(prune());
await io.write(outputPath, doc);
console.log(`Baked texture colors into vertex colors: ${outputPath}`);

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function srgbToLinear(value) {
  if (value <= 0.04045) return value / 12.92;
  return ((value + 0.055) / 1.055) ** 2.4;
}

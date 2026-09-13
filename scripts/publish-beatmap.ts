// @ts-nocheck -- Node admin script; imports .ts sources via strip-types + path alias.
/**
 * Publish a beatmap to Firestore so the `submitRun` Function can verify runs
 * against it (`beatmaps/{levelId}` with the same content hash the app ships).
 *
 * Usage (from the repo root, with Application Default Credentials for the
 * cardiosurf-mvp project — e.g. `gcloud auth application-default login` or
 * GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key kept
 * OUTSIDE the repo):
 *
 *   npm --prefix functions install            # once: firebase-admin lives there
 *   node --import ./scripts/register-src-alias.mjs --experimental-strip-types \
 *     scripts/publish-beatmap.ts <levelId> [--unpublish] [--project cardiosurf-mvp]
 *
 * The JSON must exist at src/data/beatmaps/<levelId>.json AND be registered in
 * src/lib/beatmapRegistry.ts in the same app release — the server rejects any
 * submission whose hash differs from the published copy, so publish and ship
 * together. Re-running with a changed file overwrites the hash (old builds
 * then stop submitting until they update).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beatmapHash, parseBeatmap } from '../shared/scoring/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const functionsRequire = createRequire(join(repoRoot, 'functions', 'package.json'));

const args = process.argv.slice(2);
const levelId = args.find((arg) => !arg.startsWith('--'));
const unpublish = args.includes('--unpublish');
const projectFlag = args.indexOf('--project');
const projectId =
  projectFlag >= 0 ? args[projectFlag + 1] : process.env.GOOGLE_CLOUD_PROJECT || 'cardiosurf-mvp';

if (!levelId) {
  console.error('Usage: publish-beatmap.ts <levelId> [--unpublish] [--project <id>]');
  process.exit(2);
}

const file = join(repoRoot, 'src', 'data', 'beatmaps', `${levelId}.json`);
const beatmap = parseBeatmap(JSON.parse(readFileSync(file, 'utf8')));
if (!beatmap) {
  console.error(`Invalid beatmap: ${file}`);
  process.exit(1);
}
if (beatmap.levelId !== levelId) {
  console.error(`levelId mismatch: file says "${beatmap.levelId}", argument was "${levelId}"`);
  process.exit(1);
}

const { initializeApp, applicationDefault } = functionsRequire('firebase-admin/app');
const { getFirestore, FieldValue } = functionsRequire('firebase-admin/firestore');

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const hash = beatmapHash(beatmap);

if (unpublish) {
  await db.doc(`beatmaps/${levelId}`).set({ published: false, unpublishedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`Unpublished beatmaps/${levelId}`);
} else {
  await db.doc(`beatmaps/${levelId}`).set({
    version: beatmap.version,
    levelId: beatmap.levelId,
    videoDurationSec: beatmap.videoDurationSec,
    orientation: beatmap.orientation,
    cues: beatmap.cues,
    hash,
    published: true,
    publishedAt: FieldValue.serverTimestamp(),
  });
  console.log(`Published beatmaps/${levelId} (${beatmap.cues.length} cues, ${beatmap.videoDurationSec}s, hash ${hash}) to ${projectId}`);
}

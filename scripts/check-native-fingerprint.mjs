/**
 * Guard for the `appVersion` runtime version policy used by EAS Update.
 *
 * That policy delivers an OTA update to every installed build whose app `version`
 * matches, so changing native code without bumping `version` would push JS to a
 * binary that cannot run it. This compares the project's current native
 * fingerprint against the one recorded for the last build of this version.
 *
 * Usage:
 *   node scripts/check-native-fingerprint.mjs           # verify (npm run ota:check)
 *   node scripts/check-native-fingerprint.mjs --write    # record (npm run ota:baseline)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(projectRoot, 'native-fingerprint.json');
const write = process.argv.includes('--write');

const appVersion = JSON.parse(readFileSync(join(projectRoot, 'app.json'), 'utf8')).expo.version;
const { hash } = JSON.parse(
  execFileSync('npx', ['expo-updates', 'fingerprint:generate', '--platform', 'ios'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
);

if (write) {
  writeFileSync(
    baselinePath,
    `${JSON.stringify({ version: appVersion, ios: hash }, null, 2)}\n`
  );
  console.log(`Recorded iOS native fingerprint ${hash} for app version ${appVersion}.`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('No native-fingerprint.json yet. Run `npm run ota:baseline` after your next production build.');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

if (baseline.version !== appVersion) {
  console.error(
    `app.json version is ${appVersion} but the recorded build is ${baseline.version}.\n` +
      'Ship a build of the new version, then run `npm run ota:baseline` before publishing updates.'
  );
  process.exit(1);
}

if (baseline.ios !== hash) {
  console.error(
    `Native code changed since the ${appVersion} build (${baseline.ios} -> ${hash}).\n` +
      'Do NOT publish an OTA update: it would reach builds without these native changes.\n' +
      'Bump "version" in app.json, run a new build, then run `npm run ota:baseline`.\n' +
      'To see what changed: npx expo-updates fingerprint:generate --platform ios'
  );
  process.exit(1);
}

console.log(`Native fingerprint matches the ${appVersion} build. Safe to publish an OTA update.`);

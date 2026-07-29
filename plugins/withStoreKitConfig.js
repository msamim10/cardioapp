const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Local StoreKit Testing support (additive, dev-only).
 *
 * On `expo prebuild` this plugin:
 *   1. Copies the tracked source-of-truth `storekit/CardioSurf.storekit` into the
 *      regenerated `ios/<projectName>/` folder (so it survives `--clean`), and
 *   2. Adds a <StoreKitConfigurationFileReference> to the app scheme's
 *      LaunchAction, which is what makes the iOS "Run" build serve products from
 *      the StoreKit config file instead of App Store Connect.
 *
 * IMPORTANT:
 *   - This ONLY affects the LaunchAction (i.e. pressing Run in Xcode). Archive /
 *     Release builds (EAS, TestFlight, App Store) are untouched.
 *   - It is skipped entirely on EAS builds (EAS_BUILD env), so the production /
 *     store path never sees the StoreKit config file.
 *   - StoreKit config files are only honored when the app is launched from Xcode
 *     directly. `expo run:ios` / xcodebuild / simctl launches do NOT apply them.
 */

const STOREKIT_FILENAME = 'CardioSurf.storekit';
const SOURCE_RELATIVE = path.join('storekit', STOREKIT_FILENAME);

function isEasBuild() {
  return process.env.EAS_BUILD === 'true' || process.env.EAS_BUILD === '1';
}

const withCopyStoreKitConfig = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      if (isEasBuild()) return cfg;

      const { projectRoot, platformProjectRoot, projectName } = cfg.modRequest;
      const source = path.join(projectRoot, SOURCE_RELATIVE);
      if (!fs.existsSync(source)) {
        console.warn(`[withStoreKitConfig] source not found at ${source}, skipping`);
        return cfg;
      }

      const destDir = path.join(platformProjectRoot, projectName);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(source, path.join(destDir, STOREKIT_FILENAME));

      return cfg;
    },
  ]);

const withStoreKitSchemeReference = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      if (isEasBuild()) return cfg;

      const { platformProjectRoot, projectName } = cfg.modRequest;
      const schemePath = path.join(
        platformProjectRoot,
        `${projectName}.xcodeproj`,
        'xcshareddata',
        'xcschemes',
        `${projectName}.xcscheme`
      );

      if (!fs.existsSync(schemePath)) {
        console.warn(`[withStoreKitConfig] scheme not found at ${schemePath}, skipping`);
        return cfg;
      }

      let xml = fs.readFileSync(schemePath, 'utf8');
      if (xml.includes('StoreKitConfigurationFileReference')) return cfg;

      // Xcode resolves this identifier relative to the .xcworkspace/.xcodeproj
      // bundle directory (both live in ios/), i.e. "../<projectName>/<file>".
      const workspacePath = path.join(platformProjectRoot, `${projectName}.xcworkspace`);
      const storeKitDest = path.join(platformProjectRoot, projectName, STOREKIT_FILENAME);
      const identifier = path.relative(workspacePath, storeKitDest);

      const reference =
        `      <StoreKitConfigurationFileReference\n` +
        `         identifier = "${identifier}">\n` +
        `      </StoreKitConfigurationFileReference>\n`;

      const patched = xml.replace(/(\n)(\s*<\/LaunchAction>)/, `\n${reference}$2`);
      if (patched === xml) {
        console.warn('[withStoreKitConfig] could not find </LaunchAction> to patch, skipping');
        return cfg;
      }

      fs.writeFileSync(schemePath, patched, 'utf8');
      return cfg;
    },
  ]);

module.exports = function withStoreKitConfig(config) {
  config = withCopyStoreKitConfig(config);
  config = withStoreKitSchemeReference(config);
  return config;
};

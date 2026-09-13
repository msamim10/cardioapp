/**
 * Node ESM loader so replay scripts can import app modules that use `@/` and
 * `@shared/` paths, and so the dependency-free `shared/` package (which uses
 * extension-less relative imports for the Functions build) resolves under
 * `--experimental-strip-types`.
 * Usage: node --import ./scripts/register-src-alias.mjs --experimental-strip-types <script>
 */
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'src');
const sharedRoot = join(repoRoot, 'shared');

register(
  `data:text/javascript,${encodeURIComponent(`
    import { existsSync, statSync } from 'node:fs';
    import { pathToFileURL, fileURLToPath } from 'node:url';
    const srcRoot = ${JSON.stringify(srcRoot)};
    const sharedRoot = ${JSON.stringify(sharedRoot)};
    function withTsExtension(absolute) {
      if (/\\.(ts|tsx|mjs|js|json)$/.test(absolute)) return absolute;
      if (existsSync(absolute) && statSync(absolute).isDirectory()) return absolute + '/index.ts';
      return absolute + '.ts';
    }
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) {
        return nextResolve(pathToFileURL(withTsExtension(srcRoot + '/' + specifier.slice(2))).href, context);
      }
      if (specifier.startsWith('@shared/')) {
        return nextResolve(pathToFileURL(withTsExtension(sharedRoot + '/' + specifier.slice('@shared/'.length))).href, context);
      }
      if (
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        context.parentURL &&
        context.parentURL.startsWith('file:') &&
        fileURLToPath(context.parentURL).startsWith(sharedRoot)
      ) {
        const parentDir = fileURLToPath(new URL('.', context.parentURL));
        const absolute = new URL(specifier, pathToFileURL(parentDir + '/')).pathname;
        return nextResolve(pathToFileURL(withTsExtension(absolute)).href, context);
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'register-src-alias.mjs')).href
);

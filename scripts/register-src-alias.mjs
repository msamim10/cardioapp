/**
 * Node ESM loader so replay scripts can import app modules that use `@/` paths.
 * Usage: node --import ./scripts/register-src-alias.mjs --experimental-strip-types <script>
 */
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

register(
  `data:text/javascript,${encodeURIComponent(`
    import { pathToFileURL } from 'node:url';
    const srcRoot = ${JSON.stringify(srcRoot)};
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) {
        const absolute = srcRoot + '/' + specifier.slice(2);
        const withExt = absolute.endsWith('.ts') || absolute.endsWith('.tsx')
          ? absolute
          : absolute + '.ts';
        return nextResolve(pathToFileURL(withExt).href, context);
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'register-src-alias.mjs')).href
);

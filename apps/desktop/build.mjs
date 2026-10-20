// Сборка main- и preload-процессов Electron в dist/apps/desktop.
import { build } from 'esbuild';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outdir = resolve(root, 'dist/apps/desktop');
const production = process.env.NODE_ENV === 'production';

rmSync(outdir, { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: !production,
  minify: production,
  external: ['electron'],
  tsconfig: resolve(here, 'tsconfig.app.json'),
  logLevel: 'warning',
};

await build({ ...common, entryPoints: { main: resolve(here, 'src/main/main.ts') }, outdir });
// preload в песочнице не может загружать модули, кроме electron, поэтому собирается одним файлом.
await build({ ...common, entryPoints: { preload: resolve(here, 'src/preload/preload.ts') }, outdir });

// package.json рядом с main.js: из него Electron берёт имя и версию программы (app.getName/getVersion).
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
writeFileSync(
  resolve(outdir, 'package.json'),
  JSON.stringify({ name: pkg.name, productName: pkg.name, version: pkg.version, main: 'main.js', private: true }, null, 2) + '\n',
);

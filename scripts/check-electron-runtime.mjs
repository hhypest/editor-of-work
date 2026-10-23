import { build } from 'esbuild'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { runRuntimeProbe } from './electron-runtime-process.mjs'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'test-results/electron-runtime')
const require = createRequire(import.meta.url)
// Удаляем прошлый отчёт даже при ошибке подготовки, чтобы он не стал доказательством успеха.
await rm(output, { recursive: true, force: true })
const directory = await mkdtemp(join(tmpdir(), 'eow-electron-runtime-'))
try {
  const executable = require('electron')
  const { version } = JSON.parse(await readFile(require.resolve('electron/package.json'), 'utf8'))
  await cp(join(root, 'dist/apps/desktop/migrations'), join(directory, 'migrations'), {
    recursive: true,
  })
  await cp(join(root, 'dist/apps/ui/browser'), join(directory, 'ui'), { recursive: true })
  await cp(join(root, 'dist/apps/desktop/preload.js'), join(directory, 'preload.js'))
  const entry = join(directory, 'main.cjs')
  await build({
    entryPoints: [join(root, 'apps/desktop/src/runtime-check/main.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    tsconfig: join(root, 'apps/desktop/tsconfig.app.json'),
    logLevel: 'warning',
  })
  const report = await runRuntimeProbe({
    executable,
    entry,
    reportPath: join(directory, 'report.json'),
    version,
  })
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

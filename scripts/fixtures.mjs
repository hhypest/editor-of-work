// Собирает вымышленные выгрузки паспорта (#14, ADR-0008). Генератор написан на TypeScript:
// esbuild собирает его во временный файл, затем он запускается в Node.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const entry = 'libs/import/infrastructure/src/lib/testing/passport/cli.ts'
const bundle = 'tmp/fixtures/generator.cjs'

mkdirSync(`${root}tmp/fixtures`, { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bundle,
  tsconfig: 'tsconfig.base.json',
  logLevel: 'warning',
})
execFileSync(process.execPath, [bundle, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })

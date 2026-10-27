// Переносная сборка (#6, ADR-0002): один exe без установки, папка data рядом с ним.
// Запускается только вручную: `npm run package:portable` на Windows или workflow «Portable exe»
// с кнопкой владельца. Ничего не публикует: exe и файл SHA-256 остаются в dist/release.
// `--dir` собирает распакованную программу для текущей ОС — для проверки состава без NSIS.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'electron-builder'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'dist/release')
const dirOnly = process.argv.includes('--dir')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

/** Конфигурация electron-builder; экспорт нужен тесту состава. */
export const config = {
  appId: 'io.github.hhypest.editor-of-work',
  productName: 'editor-of-work',
  copyright: 'Copyright © 2026 Манченко Иван Григорьевич',
  directories: { app: 'dist/apps/desktop', output: 'dist/release' },
  // Electron из lock-файла: тот же, что прошёл check:electron и test:e2e; ничего не скачивается.
  electronDist: 'node_modules/electron/dist',
  // main и preload собраны esbuild, интерфейс — Angular: node_modules в программе не нужны.
  files: ['**/*', '!**/*.map', '!node_modules{,/**}'],
  extraResources: [
    // main ищет интерфейс в resources/ui (apps/desktop/src/main/main.ts, uiRoot).
    { from: 'dist/apps/ui/browser', to: 'ui' },
    { from: 'LICENSE', to: 'licenses/LICENSE.txt' },
    { from: 'dist/apps/ui/3rdpartylicenses.txt', to: 'licenses/3rdpartylicenses.txt' },
  ],
  asar: true,
  // electronDist из node_modules содержит заставку default_app.asar; в программе она не нужна.
  afterPack: async ({ appOutDir }) => {
    await rm(join(appOutDir, 'resources', 'default_app.asar'), { force: true })
  },
  electronLanguages: ['ru', 'en-US'],
  npmRebuild: false,
  // Программа не обращается к сети: ни автообновления, ни публикации из сборки.
  publish: null,
  win: { target: [{ target: 'portable', arch: ['x64'] }] },
  portable: {
    artifactName: '${productName}-${version}-portable.${ext}',
    requestExecutionLevel: 'user',
    unicode: true,
  },
  linux: { target: 'dir' },
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await rm(output, { recursive: true, force: true })
  // Production-сборка без кэша Nx: в exe не попадают отладочные карты и устаревший вывод.
  execFileSync('npx', ['nx', 'run-many', '-t', 'build', '--skip-nx-cache'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, NODE_ENV: 'production' },
  })
  await build({ projectDir: root, config, dir: dirOnly, publish: 'never' })
  if (dirOnly) {
    console.log(`Распакованная программа ${version}: ${output}`)
  } else {
    const exe = (await readdir(output)).find((name) => name.endsWith('-portable.exe'))
    if (!exe) throw new Error(`В ${output} нет portable exe`)
    const digest = await sha256(join(output, exe))
    // Формат sha256sum: проверка `sha256sum -c` или Get-FileHash в PowerShell.
    await writeFile(join(output, `${exe}.sha256`), `${digest} *${basename(exe)}\n`)
    console.log(`${exe}\nSHA-256 ${digest}`)
  }
}

// Проверка переносного exe (#6) на Windows после `npm run package:portable`:
// контрольная сумма совпадает с файлом .sha256, exe из папки с пробелом и кириллицей
// запускается без установки и создаёт базу паспорта в data рядом с собой, а не в профиле.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const release = join(root, 'dist/release')
const output = join(root, 'test-results/portable')
// Распаковка ~100 МБ во временную папку при первом запуске занимает время.
const LIMIT = 180_000

assert.equal(process.platform, 'win32', 'Переносной exe проверяется только на Windows')
const exe = (await readdir(release)).find((name) => name.endsWith('-portable.exe'))
assert.ok(exe, `В ${release} нет portable exe; сначала npm run package:portable`)

const hash = createHash('sha256')
for await (const chunk of createReadStream(join(release, exe))) hash.update(chunk)
const digest = hash.digest('hex')
const recorded = (await readFile(join(release, `${exe}.sha256`), 'utf8')).trim()
assert.equal(recorded, `${digest} *${exe}`, 'Файл .sha256 не совпадает с exe')

await rm(output, { recursive: true, force: true })
const work = await mkdtemp(join(tmpdir(), 'eow-portable-'))
const folder = join(work, 'Переносная программа')
const local = join(work, 'local')
await mkdir(folder)
await copyFile(join(release, exe), join(folder, exe))
const started = Date.now()
const child = spawn(join(folder, exe), [], {
  cwd: work,
  env: { ...process.env, LOCALAPPDATA: local },
  stdio: 'ignore',
})
let exited = null
child.on('exit', (code) => {
  exited = code
})
try {
  const database = join(folder, 'data', 'passport.sqlite')
  while (!existsSync(database)) {
    assert.equal(exited, null, `exe завершился с кодом ${exited} до создания базы`)
    assert.ok(Date.now() - started < LIMIT, `База не появилась рядом с exe за ${LIMIT / 1000} с`)
    await new Promise((done) => setTimeout(done, 1000))
  }
  // Программа продолжает работать после открытия базы, а профиль пользователя не тронут.
  await new Promise((done) => setTimeout(done, 5000))
  assert.equal(exited, null, `exe завершился с кодом ${exited} после создания базы`)
  assert.equal(existsSync(join(local, 'editor-of-work')), false, 'База создана в профиле')
  const report = {
    status: 'passed',
    exe,
    sha256: digest,
    bytes: (await stat(join(folder, exe))).size,
    databaseAfterMs: Date.now() - started,
  }
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  try {
    execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // Процесс уже завершён.
  }
  await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}

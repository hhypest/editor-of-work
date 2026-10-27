import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { snapshotStore } from '../e2e/snapshots.mjs'
import { explanationError, HEADING } from '../check-snapshot-explanation.mjs'

function png(width, height, paint = () => [255, 255, 255]) {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [r, g, b] = paint(x, y)
      image.data.set([r, g, b, 255], i)
    }
  return PNG.sync.write(image)
}

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'eow-snapshots-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, output: join(root, 'out') }
}

test('обновление пишет эталон, сравнение с ним проходит', async (t) => {
  const { root, output } = await workspace(t)
  const image = png(40, 30)
  const update = snapshotStore({
    root,
    output,
    platform: 'win32',
    env: { EOW_UPDATE_SNAPSHOTS: '1' },
  })
  await update.compare('pd-1-1', image)
  assert.deepEqual(await readdir(join(root, 'scripts/e2e/snapshots/win32')), ['pd-1-1.png'])
  const check = snapshotStore({ root, output, platform: 'win32', env: { CI: 'true' } })
  await check.compare('pd-1-1', image)
  await check.verify()
  assert.deepEqual(check.checked, ['pd-1-1'])
})

test('без эталона локально — отметка, в CI — ошибка шага', async (t) => {
  const { root, output } = await workspace(t)
  const local = snapshotStore({ root, output, platform: 'linux', env: {} })
  await local.compare('overview-1', png(10, 10))
  await local.verify()
  assert.deepEqual(local.missing, ['overview-1'])
  const ci = snapshotStore({ root, output, platform: 'linux', env: { CI: 'true' } })
  await ci.compare('overview-1', png(10, 10))
  await assert.rejects(() => ci.verify(), /нет эталона linux\/overview-1\.png/u)
})

test('изменённый лист и другой размер дают ошибку со всеми расхождениями и картой разницы', async (t) => {
  const { root, output } = await workspace(t)
  const dir = join(root, 'scripts/e2e/snapshots/win32')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'pd-1-1.png'), png(100, 100))
  await writeFile(join(dir, 'pd-1-2.png'), png(100, 100))
  const store = snapshotStore({ root, output, platform: 'win32', env: { CI: 'true' } })
  // Чёрная полоса 10 × 100 — 10 % пикселей, далеко за порогом.
  await store.compare(
    'pd-1-1',
    png(100, 100, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255])),
  )
  await store.compare('pd-1-2', png(100, 90))
  await assert.rejects(
    () => store.verify(),
    (error) => {
      assert.match(error.message, /\(2\)/u)
      assert.match(error.message, /pd-1-1: отличается 1000 пикселей/u)
      assert.match(error.message, /pd-1-2: размер 100×90, в эталоне 100×100/u)
      return true
    },
  )
  const diff = PNG.sync.read(await readFile(join(output, 'snapshots/pd-1-1.diff.png')))
  assert.equal(diff.width, 100)
})

test('единичные пиксели сглаживания не считаются изменением листа', async (t) => {
  const { root, output } = await workspace(t)
  const dir = join(root, 'scripts/e2e/snapshots/win32')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'a.png'), png(200, 200))
  const store = snapshotStore({ root, output, platform: 'win32', env: { CI: 'true' } })
  await store.compare(
    'a',
    png(200, 200, (x, y) => (x === 5 && y === 5 ? [0, 0, 0] : [255, 255, 255])),
  )
  await store.verify()
})

test('эталоны без раздела объяснения в описании PR не принимаются', () => {
  const changed = ['scripts/e2e/snapshots/win32/pd-1-1.png', 'apps/ui/src/main.ts']
  assert.equal(explanationError(['apps/ui/src/main.ts'], ''), null)
  assert.match(explanationError(changed, 'Описание без раздела') ?? '', /pd-1-1\.png/u)
  assert.match(
    explanationError(changed, `${HEADING}\n<!-- что изменилось -->\n\n## Проверка\n- ok`) ?? '',
    /Изменение эталонов/u,
  )
  assert.equal(
    explanationError(changed, `## Что\nтекст\r\n${HEADING}\r\nШире колонка «Ед.».\r\n`),
    null,
  )
})

test('эталон листа, который больше не снимается, — расхождение; обновление его удаляет', async (t) => {
  const { root, output } = await workspace(t)
  const dir = join(root, 'scripts/e2e/snapshots/win32')
  await mkdir(dir, { recursive: true })
  for (const name of ['pd-1-1', 'pd-1-2', 'pd-1-3'])
    await writeFile(join(dir, `${name}.png`), png(20, 20))
  const store = snapshotStore({ root, output, platform: 'win32', env: { CI: 'true' } })
  await store.compare('pd-1-1', png(20, 20))
  await assert.rejects(
    () => store.verify(),
    (error) => {
      assert.match(error.message, /\(2\)/u)
      assert.match(error.message, /pd-1-2: лист есть в эталонах, но не снят/u)
      assert.match(error.message, /pd-1-3: лист есть в эталонах, но не снят/u)
      return true
    },
  )
  const update = snapshotStore({
    root,
    output,
    platform: 'win32',
    env: { EOW_UPDATE_SNAPSHOTS: '1' },
  })
  await update.compare('pd-1-1', png(20, 20))
  await update.verify()
  assert.deepEqual(await readdir(dir), ['pd-1-1.png'])
})

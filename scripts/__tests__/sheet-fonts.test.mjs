import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fontHashes,
  glyphs,
  advances,
} from '../../libs/documents/application/src/lib/testing/font-advances.ts'

const require = createRequire(import.meta.url)

test('таблицы метрик соответствуют поставляемым файлам PT Sans', () => {
  for (const [path, expected] of Object.entries(fontHashes)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(require.resolve(path)))
        .digest('hex'),
      expected,
      path,
    )
  }
  for (const widths of Object.values(advances)) assert.equal(widths.length, [...glyphs].length)
})

for (const family of ['pt-sans', 'pt-sans-narrow']) {
  test(`лицензия ${family} включена в статические ресурсы`, () => {
    const name = family === 'pt-sans' ? 'PT-Sans' : 'PT-Sans-Narrow'
    assert.equal(
      readFileSync(`apps/ui/public/licenses/${name}-OFL.txt`, 'utf8'),
      readFileSync(require.resolve(`@fontsource/${family}/LICENSE`), 'utf8'),
    )
  })
}

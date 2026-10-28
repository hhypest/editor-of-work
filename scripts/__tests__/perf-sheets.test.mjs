import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sep } from 'node:path'
import { BASELINE_FIELDS, baselineOf, baselinePath, compareWithBaseline } from '../perf-sheets.mjs'

const timing = (median) => ({ count: 3, median, p95: median, max: median })
const report = {
  version: '0.5.0-beta.1',
  engine: { node: '24.0.0', v8: '13', electron: '44.9.0' },
  machine: { platform: 'win32', cpu: 'Учебный процессор', cores: 4 },
  profiles: [
    {
      id: 'typical',
      title: 'Типовой',
      size: { pages: 67 },
      ...Object.fromEntries(BASELINE_FIELDS.map((field, i) => [field, timing(10 * (i + 1))])),
    },
  ],
}

test('базовая линия хранит медианы и число листов, но не сведения о машине', () => {
  const baseline = baselineOf(report)
  assert.equal(baseline.machine, undefined)
  assert.deepEqual(baseline.profiles.typical, {
    pages: 67,
    openMs: 10,
    sheetMs: 20,
    editMs: 30,
    afterEditMs: 40,
    batchMs: 50,
    saveMs: 60,
  })
})

test('сравнение показывает отношение к базовой линии; без неё — пусто', () => {
  const baseline = baselineOf(report)
  baseline.profiles.typical.afterEditMs = 20
  const rows = compareWithBaseline(report, baseline)
  assert.equal(rows.length, BASELINE_FIELDS.length)
  assert.deepEqual(
    rows.find((row) => row.field === 'afterEditMs'),
    { profile: 'Типовой', field: 'afterEditMs', median: 40, baseline: 20, ratio: 2 },
  )
  assert.ok(compareWithBaseline(report, null).every((row) => row.ratio === null))
})

test('базовая линия пишется в файл ОС, на которой снят отчёт', () => {
  assert.equal(
    baselinePath('/repo', report),
    '/repo/scripts/perf/baseline/win32.json'.replaceAll('/', sep),
  )
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRuntimeProbe } from '../electron-runtime-process.mjs'

const report = {
  status: 'passed',
  processType: 'browser',
  electron: '44.9.0',
  node: '24.0.0',
  sqlite: '3.50.0',
  pdf: { pages: 2, widthMm: 420, heightMm: 297, embeddedFonts: 4, svgMatches: true },
  checks: [
    'create',
    'migrations-and-wal',
    'activate-and-archive',
    'backup-before-activation',
    'reopen',
  ],
}
async function probe(t, script) {
  const directory = await mkdtemp(join(tmpdir(), 'eow-runtime-runner-test-'))
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3 }))
  const reportPath = join(directory, 'report.json')
  const entry = join(directory, 'probe.cjs')
  await writeFile(entry, script(reportPath))
  return { executable: process.execPath, entry, reportPath, version: report.electron }
}
const writesReport = (path, value = report) =>
  `require('node:fs').writeFileSync(${JSON.stringify(path)}, ${JSON.stringify(JSON.stringify(value))})`

test('принимает только полный отчёт после успешного выхода', async (t) => {
  assert.deepEqual(await runRuntimeProbe(await probe(t, (path) => writesReport(path))), report)
})
test('нулевой exit без отчёта не делает проверку зелёной', async (t) => {
  await assert.rejects(runRuntimeProbe(await probe(t, () => 'process.exit(0)')), /ENOENT/u)
})
test('отчёт не скрывает ненулевой exit', async (t) => {
  await assert.rejects(
    runRuntimeProbe(await probe(t, (path) => writesReport(path) + '; process.exit(7)')),
    /exit=7/u,
  )
})
test('неполные проверки и чужой runtime отклоняются', async (t) => {
  for (const patch of [
    { checks: ['create'] },
    { electron: '0.0.0' },
    { processType: 'node' },
    { sqlite: 'undefined' },
    { pdf: undefined },
    { pdf: { ...report.pdf, pages: 1 } },
    { pdf: { ...report.pdf, widthMm: 297 } },
    { pdf: { ...report.pdf, embeddedFonts: 0 } },
    { pdf: { ...report.pdf, svgMatches: false } },
  ]) {
    await assert.rejects(
      runRuntimeProbe(await probe(t, (path) => writesReport(path, { ...report, ...patch }))),
    )
  }
})
test('зависший процесс принудительно завершается и отклоняется', async (t) => {
  const options = await probe(t, () => 'setInterval(() => {}, 1000)')
  await assert.rejects(runRuntimeProbe({ ...options, timeoutMs: 300 }), /тайм-аут/u)
})
test('ошибка запуска отклоняется', async (t) => {
  const options = await probe(t, () => '')
  await assert.rejects(runRuntimeProbe({ ...options, executable: join(options.entry, 'missing') }))
})
test('переменные подмены runtime и Node-флагов не передаются дочернему процессу', async (t) => {
  const options = await probe(
    t,
    (path) =>
      `require('node:assert/strict').equal(process.env.ELECTRON_RUN_AS_NODE, undefined);
       require('node:assert/strict').equal(process.env.NODE_OPTIONS, undefined);
       ${writesReport(path)}`,
  )
  const oldRunAsNode = process.env.ELECTRON_RUN_AS_NODE
  const oldOptions = process.env.NODE_OPTIONS
  try {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    process.env.NODE_OPTIONS = '--not-a-real-option'
    await runRuntimeProbe(options)
  } finally {
    if (oldRunAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE
    else process.env.ELECTRON_RUN_AS_NODE = oldRunAsNode
    if (oldOptions === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = oldOptions
  }
})

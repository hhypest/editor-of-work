import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

/** Не принимаем успешный exit без полного отчёта: Electron мог выйти до проверки. */
export async function runRuntimeProbe({
  executable,
  entry,
  reportPath,
  version,
  timeoutMs = 60000,
}) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  await new Promise((resolve, reject) => {
    const child = spawn(executable, [entry], { env, stdio: 'inherit', windowsHide: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error('Electron runtime check: превышен тайм-аут'))
      else if (code !== 0 || signal)
        reject(new Error(`Electron runtime check: exit=${code}, signal=${signal}`))
      else resolve()
    })
  })
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(report.status, 'passed')
  assert.equal(report.processType, 'browser')
  assert.equal(report.electron, version)
  assert.match(report.node, /^\d+\.\d+\.\d+$/u)
  assert.match(report.sqlite, /^\d+\.\d+\.\d+$/u)
  assert.deepEqual(report.checks, [
    'create',
    'migrations-and-wal',
    'activate-and-archive',
    'backup-before-activation',
    'reopen',
  ])
  assert.equal(report.pdf?.pages, 1)
  assert.equal(report.pdf?.svgMatches, true)
  assert.ok(Math.abs(report.pdf?.widthMm - 420) < 0.5)
  assert.ok(Math.abs(report.pdf?.heightMm - 297) < 0.5)
  assert.ok(report.pdf?.embeddedFonts >= 4)
  return report
}

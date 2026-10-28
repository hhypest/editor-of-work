// Замер подготовки листов на вымышленных планах (ADR-0045): `npm run test:perf`.
// Собирает apps/desktop/src/perf во временный файл и запускает его в Node из Electron
// (ELECTRON_RUN_AS_NODE): тот же движок V8, что в программе. Отчёт —
// test-results/perf/report.json; сравнение с базовой линией scripts/perf/baseline/<ОС>.json
// справочное, команда падает только при крупной регрессии. EOW_UPDATE_PERF_BASELINE=1
// записывает базовую линию из нового замера, `--baseline-from <report.json>` — из отчёта CI.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Показатели базовой линии: медианы, по которым видно замедление. */
export const BASELINE_FIELDS = ['openMs', 'sheetMs', 'editMs', 'afterEditMs', 'batchMs', 'saveMs']

/** Базовая линия из отчёта: только медианы и размеры профилей, без сведений о машине. */
export function baselineOf(report) {
  return {
    version: report.version,
    engine: report.engine,
    profiles: Object.fromEntries(
      report.profiles.map((profile) => [
        profile.id,
        {
          pages: profile.size.pages,
          ...Object.fromEntries(BASELINE_FIELDS.map((field) => [field, profile[field].median])),
        },
      ]),
    ),
  }
}

/** Строки «профиль · показатель · медиана · базовая · отношение» для вывода. */
export function compareWithBaseline(report, baseline) {
  const rows = []
  for (const profile of report.profiles) {
    const base = baseline?.profiles?.[profile.id]
    for (const field of BASELINE_FIELDS) {
      const median = profile[field].median
      const before = base?.[field]
      rows.push({
        profile: profile.title,
        field,
        median,
        baseline: before ?? null,
        ratio: before ? Math.round((median / before) * 100) / 100 : null,
      })
    }
  }
  return rows
}

/** Файл базовой линии ОС, на которой снят отчёт. */
export function baselinePath(root, report) {
  return join(root, 'scripts/perf/baseline', `${report.machine.platform}.json`)
}

async function writeBaseline(root, report) {
  const path = baselinePath(root, report)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(baselineOf(report), null, 2) + '\n')
  console.log(`Базовая линия записана: scripts/perf/baseline/${report.machine.platform}.json`)
}

async function run(root) {
  const { build } = await import('esbuild')
  const require = createRequire(import.meta.url)
  const output = join(root, 'test-results/perf')
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  // Прежний отчёт удаляется до запуска, чтобы он не стал доказательством успеха.
  await rm(output, { recursive: true, force: true })
  const directory = await mkdtemp(join(tmpdir(), 'eow-perf-build-'))
  try {
    const entry = join(directory, 'perf.cjs')
    await build({
      entryPoints: [join(root, 'apps/desktop/src/perf/main.ts')],
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      // Как в production-сборке main: замер не должен включать отладочные проверки.
      minify: true,
      external: ['electron'],
      tsconfig: join(root, 'apps/desktop/tsconfig.app.json'),
      logLevel: 'warning',
    })
    await mkdir(output, { recursive: true })
    const reportPath = join(output, 'report.json')
    let failed = false
    try {
      execFileSync(require('electron'), [entry, reportPath], {
        cwd: directory,
        stdio: 'inherit',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', EOW_PERF_VERSION: version },
        timeout: 20 * 60_000,
      })
    } catch {
      failed = true
    }
    if (!existsSync(reportPath)) throw new Error('Замер не записал отчёт')
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    const path = baselinePath(root, report)
    const baseline = existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : null
    console.table(compareWithBaseline(report, baseline))
    if (process.env['EOW_UPDATE_PERF_BASELINE'] === '1') await writeBaseline(root, report)
    if (failed || report.status !== 'passed') process.exitCode = 1
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(import.meta.dirname, '..')
  const from = process.argv.indexOf('--baseline-from')
  // Базовая линия из отчёта CI (артефакт perf-*) без нового замера на этой машине.
  if (from !== -1) {
    const source = process.argv[from + 1]
    if (!source) throw new Error('Укажите отчёт: --baseline-from <report.json>')
    await writeBaseline(root, JSON.parse(await readFile(source, 'utf8')))
  } else await run(root)
}

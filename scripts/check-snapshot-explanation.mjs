// Изменение эталонных снимков листов принимается только с объяснением в описании PR (#26).
// Запуск в CI на pull_request: BASE_SHA — база PR, PR_BODY — описание PR (через env).
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const SNAPSHOTS_DIR = 'scripts/e2e/snapshots/'
export const HEADING = '## Изменение эталонов'

/** Текст ошибки или null: эталоны не менялись либо в описании есть непустой раздел. */
export function explanationError(changed, body) {
  const snapshots = changed.filter((path) => path.startsWith(SNAPSHOTS_DIR))
  if (!snapshots.length) return null
  const text = (body ?? '').replace(/\r\n/gu, '\n')
  const start = text.indexOf(`${HEADING}\n`)
  const section = start === -1 ? '' : text.slice(start + HEADING.length + 1).split(/\n## /u)[0]
  // Комментарии шаблона не считаются объяснением.
  if (section.replace(/<!--[\s\S]*?-->/gu, '').trim()) return null
  return (
    `PR меняет эталонные снимки листов (${snapshots.length}):\n` +
    snapshots.map((path) => `  ${path}`).join('\n') +
    `\nДобавьте в описание PR раздел «${HEADING.slice(3)}»: что изменилось на листах и почему.`
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const base = process.env['BASE_SHA']
  if (!base) throw new Error('Нужна переменная BASE_SHA')
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
  const error = explanationError(changed, process.env['PR_BODY'])
  if (error) {
    console.error(error)
    process.exitCode = 1
  } else console.log('Эталоны листов не менялись или изменение объяснено в PR.')
}

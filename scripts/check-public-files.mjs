// Проверка, что в индексе Git нет служебных данных дистанции (ADR-0008).
// Запуск: npm run check:public
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Расширения, которые никогда не должны попадать в репозиторий. */
export const FORBIDDEN_SUFFIXES = [
  '.xls',
  '.xlsx',
  '.xlsm',
  '.xlsb',
  '.ods',
  '.sqlite',
  '.sqlite3',
  '.sqlite-wal',
  '.sqlite-shm',
  '.sqlite-journal',
  '.db',
  '.db-wal',
  '.db-shm',
  '.db-journal',
  '.ppr.json',
  '.ppr.json.autosave',
  '.pdf',
  '.7z',
  '.zip',
  '.rar',
  '.tar',
  '.tgz',
  '.gz',
  '.bz2',
  '.xz',
  '.zst',
  '.bak',
]

/** Папки, содержимое которых не должно отслеживаться. */
export const FORBIDDEN_DIRS = ['private-data/']

export function findForbiddenFiles(paths) {
  return paths.filter((path) => {
    const lower = path.toLowerCase()
    return (
      FORBIDDEN_SUFFIXES.some((suffix) => lower.endsWith(suffix)) ||
      FORBIDDEN_DIRS.some((dir) => lower.startsWith(dir) || lower.includes(`/${dir}`))
    )
  })
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached'], { encoding: 'utf8' })
  return out.split('\0').filter(Boolean)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const forbidden = findForbiddenFiles(trackedFiles())
  if (forbidden.length > 0) {
    console.error('В репозитории не должно быть служебных данных (ADR-0008). Уберите из индекса:')
    for (const path of forbidden) console.error(`  ${path}`)
    console.error('Тестовые выгрузки собирайте программно из вымышленных данных.')
    process.exit(1)
  }
  console.log('check:public — служебных файлов в индексе нет.')
}

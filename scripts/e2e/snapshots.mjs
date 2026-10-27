// Эталонные снимки листов (#26): снимок SVG листа сравнивается попиксельно с PNG в
// scripts/e2e/snapshots/<платформа>/. Эталоны снимаются на той же ОС, что проверка:
// сглаживание шрифтов в Windows и Linux различается. Данные листов вымышленные (ADR-0008).
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

/** Порог цвета пикселя pixelmatch и доля различающихся пикселей, ниже которой снимок совпадает. */
const THRESHOLD = 0.1
const MAX_DIFF_RATIO = 0.0005

export function snapshotStore({ root, output, platform = process.platform, env = process.env }) {
  const baselines = join(root, 'scripts/e2e/snapshots', platform)
  const actuals = join(output, 'snapshots')
  const update = env['EOW_UPDATE_SNAPSHOTS'] === '1'
  // В CI отсутствие эталона — ошибка, иначе проверка молча ничего не сравнивает.
  const strict = env['CI'] === 'true' && !update
  const checked = []
  const missing = []
  // Расхождения копятся до конца шага, чтобы один прогон показал все изменённые листы.
  const failures = []
  // Все снятые листы: эталон листа, которого больше нет, тоже расхождение.
  const seen = new Set()

  return {
    checked,
    missing,
    failures,
    async compare(name, png) {
      const file = `${name}.png`
      seen.add(file)
      await mkdir(actuals, { recursive: true })
      await writeFile(join(actuals, file), png)
      const baseline = join(baselines, file)
      if (update) {
        await mkdir(baselines, { recursive: true })
        await writeFile(baseline, png)
        checked.push(name)
        return
      }
      if (!existsSync(baseline)) {
        missing.push(name)
        if (strict) failures.push(`${name}: нет эталона ${platform}/${file}`)
        return
      }
      const expected = PNG.sync.read(await readFile(baseline))
      const actual = PNG.sync.read(png)
      if (expected.width !== actual.width || expected.height !== actual.height) {
        failures.push(
          `${name}: размер ${actual.width}×${actual.height}, в эталоне ${expected.width}×${expected.height}`,
        )
        return
      }
      const diff = new PNG({ width: actual.width, height: actual.height })
      const pixels = pixelmatch(
        expected.data,
        actual.data,
        diff.data,
        actual.width,
        actual.height,
        { threshold: THRESHOLD },
      )
      const ratio = pixels / (actual.width * actual.height)
      if (ratio > MAX_DIFF_RATIO) {
        await writeFile(join(actuals, `${name}.diff.png`), PNG.sync.write(diff))
        failures.push(`${name}: отличается ${pixels} пикселей (${(ratio * 100).toFixed(3)} %)`)
        return
      }
      checked.push(name)
    },
    /** Ошибка шага со всеми расхождениями; снимки и карты разницы — в test-results/e2e/snapshots. */
    async verify() {
      const stored = existsSync(baselines)
        ? (await readdir(baselines)).filter((file) => file.endsWith('.png'))
        : []
      for (const file of stored.filter((name) => !seen.has(name)).toSorted()) {
        // При обновлении эталон исчезнувшего листа удаляется вместе с остальными изменениями.
        if (update) await rm(join(baselines, file))
        else failures.push(`${file.slice(0, -4)}: лист есть в эталонах, но не снят`)
      }
      if (failures.length)
        throw new Error(
          `Листы не совпадают с эталонами (${failures.length}):\n${failures.join('\n')}\n` +
            'Снимки и карты разницы — в test-results/e2e/snapshots. Если изменение задумано, ' +
            'обновите эталоны (docs/e2e-electron.md) и объясните его в PR.',
        )
    },
  }
}

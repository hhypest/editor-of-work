// Сквозной сценарий production-сборки в настоящем Electron (часть #37, критерии выпуска 0.5.0).
// Запускает собранные dist/apps/desktop и dist/apps/ui из временной папки, подменяет только
// системные диалоги main и проходит путь составителя на вымышленных выгрузках (ADR-0008):
// черновик → импорт 17 форм → шаблон ручных данных → ввод в действие → план → работа →
// отмена/повтор → сохранение и повторное открытие → PDF А3 → отказ файла новой версии →
// автокопия после аварийного завершения. Запуск: npm run build && npm run test:e2e
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { PDFDocument } from 'pdf-lib'
import { _electron as electron } from 'playwright'
import { snapshotStore } from './e2e/snapshots.mjs'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const output = join(root, 'test-results/e2e')
const TIMEOUT = 60_000

// Состав шагов мастера по файлам генератора фикстур (scripts/fixtures.mjs).
const STEPS = [
  {
    title: '1. Оргструктура',
    files: ['90000101.xls', '90000102.xls', '90000103.xls', '90000104.xls'],
  },
  {
    title: '2. Характеристики пути',
    files: [
      '90000107.xls',
      '90000108.xls',
      '90000109.xls',
      '90000110.xls',
      '90000111.xls',
      '90000112.xls',
    ],
  },
  {
    title: '3. Станции и переезды',
    files: [
      '90000105.xls',
      '90000106.xls',
      'Переезды общие данные.XLSX',
      'Переезды технические данные.XLSX',
      'Переезды эксплуатационные характеристики.XLSX',
      'Экспликация станционных путей.xlsx',
      'Экспликация стрелочных переводов.xlsx',
    ],
  },
]
// Нестандартные километры вымышленных направлений (testing/passport/model.ts): импорт
// только сообщает о них, составитель вводит длины на листе «Нестандартные километры».
const KM_LENGTHS = [
  ['Главный путь Северная-Южная, 1', 20, 964],
  ['Главный путь Северная-Южная, 1', 41, 1045],
  ['Главный путь Восточная-Западная, 1', 115, 990],
]
/** Каждая страница — А3 альбом 420 × 297 мм, шрифты встроены в файл. */
async function assertA3(path, pages) {
  const bytes = await readFile(path)
  const document = await PDFDocument.load(bytes)
  assert.equal(document.getPageCount(), pages)
  for (const page of document.getPages()) {
    const { width, height } = page.getSize()
    assert.ok(
      Math.abs((width * 25.4) / 72 - 420) < 0.5 && Math.abs((height * 25.4) / 72 - 297) < 0.5,
      `Страница ${width} × ${height} pt не А3 альбом`,
    )
  }
  assert.ok(bytes.includes('/FontFile2') || bytes.includes('/FontFile3'), 'Шрифты не встроены')
}

// Те же действующие подразделения, что в интеграционном тесте мастера.
const ACTIVE_UNITS = ['ПЧУ-1', 'ПЧУ-2', 'ПД-1', 'ПД-2', 'ПД-3', 'ПД-4']

const steps = []
/** Текущее окно программы: для снимка при ошибке шага. */
let current
// Шаг, который завис (например, на модальном окне), прерывается со снимком, а не держит CI.
const STEP_LIMIT = 180_000

/** Аварийное завершение всего дерева процессов Electron; закрытие соединения ограничено по времени. */
async function crash(application) {
  const child = application.process()
  try {
    // На Windows SIGKILL завершает только главный процесс; taskkill /T — всё дерево.
    if (process.platform === 'win32')
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGKILL')
  } catch {
    // Процесс уже завершён.
  }
  await Promise.race([
    application.close().catch(() => undefined),
    new Promise((done) => setTimeout(done, 10_000)),
  ])
}

async function step(name, action) {
  const started = Date.now()
  let timer
  try {
    await Promise.race([
      action(),
      new Promise((_, fail) => {
        timer = setTimeout(
          () => fail(new Error(`Шаг дольше ${STEP_LIMIT / 1000} с: ${name}`)),
          STEP_LIMIT,
        )
      }),
    ])
    steps.push({ name, ms: Date.now() - started })
    console.log(`✓ ${name} (${Date.now() - started} мс)`)
  } catch (error) {
    console.error(`✗ ${name}`)
    // Снимок окна на вымышленных данных помогает разобрать падение в CI.
    await mkdir(output, { recursive: true })
    await current
      ?.screenshot({ path: join(output, 'failure.png'), fullPage: true })
      .catch(() => undefined)
    const alerts = await current
      ?.getByRole('alert')
      .allTextContents()
      .catch(() => [])
    if (alerts?.length) console.error(`Сообщения: ${alerts.join(' | ')}`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// Прошлый отчёт удаляется до запуска, чтобы он не стал доказательством успеха.
await rm(output, { recursive: true, force: true })
const work = await mkdtemp(join(tmpdir(), 'eow-e2e-'))
let app
try {
  // В режиме без упаковки main хранит паспорт в ../../../private-data от dist/apps/desktop,
  // поэтому копия сборки во временной папке не касается рабочих данных репозитория.
  await cp(join(root, 'dist/apps/desktop'), join(work, 'dist/apps/desktop'), { recursive: true })
  await cp(join(root, 'dist/apps/ui'), join(work, 'dist/apps/ui'), { recursive: true })
  const fixtures = join(work, 'fixtures')
  execFileSync(process.execPath, [join(root, 'scripts/fixtures.mjs'), fixtures], {
    cwd: root,
    stdio: 'pipe',
  })
  const files = join(work, 'files')
  await mkdir(files)
  const fill = join(work, 'fill-manual-template.cjs')
  await build({
    absWorkingDir: root,
    entryPoints: ['scripts/e2e/fill-manual-template.ts'],
    outfile: fill,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    tsconfig: 'tsconfig.base.json',
    logLevel: 'warning',
  })

  const env = { ...process.env, LOCALAPPDATA: join(work, 'local') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  delete env.EOW_DEV_SERVER_URL
  const launch = async () => {
    const started = await electron.launch({
      executablePath: require('electron'),
      // Chromium не запускается от root без отключения песочницы; в CI и у составителя root нет.
      args: [
        ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
        // Папка приложения, как в сборке: имя и версию Electron берёт из её package.json.
        join(work, 'dist/apps/desktop'),
      ],
      env,
      timeout: TIMEOUT,
    })
    // Подменяются только системные диалоги: ответы берутся из очереди сценария.
    await started.evaluate(({ dialog }) => {
      const queue = []
      globalThis.__e2eDialogs = queue
      const next = async () => {
        const answer = queue.shift()
        if (!answer) throw new Error('E2E: нет ожидаемого ответа диалога')
        return answer
      }
      dialog.showOpenDialog = next
      dialog.showSaveDialog = next
    })
    const window = await started.firstWindow()
    window.setDefaultTimeout(TIMEOUT)
    current = window
    return { app: started, page: window }
  }
  const answer = (application, result) =>
    application.evaluate((_electron, value) => globalThis.__e2eDialogs.push(value), result)
  const open = (application, paths) => answer(application, { canceled: false, filePaths: paths })
  const save = (application, path) => answer(application, { canceled: false, filePath: path })

  let page
  ;({ app, page } = await launch())
  const nav = (name) =>
    page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const status = (text) => page.getByRole('status').filter({ hasText: text })

  await step('шапка показывает версию продукта и формат плана', async () => {
    await page.getByText(`версия ${version}`).waitFor()
  })
  await step('создание черновика паспорта в новой базе', async () => {
    await page.locator('#draft-date').fill('2026-10-22')
    await page.locator('#draft-label').fill('Учебная редакция')
    await button('Создать черновик').click()
    await page.getByRole('cell', { name: 'Учебная редакция' }).waitFor()
    await stat(join(work, 'private-data'))
  })
  await step('импорт вымышленного комплекта 17 форм', async () => {
    await nav('Импорт выгрузок').click()
    for (const { title, files: names } of STEPS) {
      await page
        .getByRole('navigation', { name: 'Шаги импорта' })
        .getByRole('button', { name: title })
        .click()
      await open(
        app,
        names.map((name) => join(fixtures, name)),
      )
      await button('Выбрать формы и все их части').click()
      if (title.startsWith('1.')) {
        for (const code of ACTIVE_UNITS)
          await page.getByRole('checkbox', { name: new RegExp(`^${code} ·`, 'u') }).check()
        await button('Проверить выбранные подразделения').click()
      }
      await page.getByRole('heading', { name: 'Проверка перед записью' }).waitFor()
      await button('Подтвердить замену пакета').click()
      await status('Пакет сохранён').waitFor()
    }
  })
  await step(
    'шаблон ручных данных с типовым перечнем: выдача, загрузка, подтверждение',
    async () => {
      await nav('Ручные данные').click()
      await page.locator('#manual-typical').check()
      const book = join(files, 'Ручные данные.xlsx')
      await save(app, book)
      await button('Выдать шаблон').click()
      await status('Шаблон сохранён').waitFor()
      execFileSync(process.execPath, [fill, book, JSON.stringify(KM_LENGTHS)], { stdio: 'pipe' })
      await open(app, [book])
      await button('Загрузить заполненную книгу').click()
      await button('Подтвердить замену ручных данных').click()
      await status('Ручные данные сохранены').waitFor()
    },
  )
  await step('ввод редакции в действие', async () => {
    await nav('Паспорт').click()
    await button('Ввести в действие').click()
    await button('Подтвердить').click()
    await page.getByRole('cell', { name: 'Действующая' }).waitFor()
  })
  await step('создание плана из действующей редакции', async () => {
    await nav('Годовой план').click()
    await page.getByText('Новый план из паспорта').click()
    await button('Загрузить редакции паспорта').click()
    await page.locator('#new-plan-edition').selectOption({ index: 1 })
    await page.locator('#new-plan-year').fill('2027')
    await button('Создать новый план').click()
    await page.getByText('План 2027').waitFor()
    await page.getByText('У плана пока нет файла').waitFor()
  })
  const kindName = 'Планово-предупредительная выправка пути комплексами машин (В)'
  await step('ошибка места у поля и добавление работы', async () => {
    await page.locator('#work-kind').selectOption('ТС-001')
    await page.locator('#work-mode').selectOption('line')
    await page.locator('#work-line').selectOption({ label: 'Главный путь Северная-Южная, 1' })
    await page.locator('#work-place').fill('12 км пк 11')
    await button('Применить работу').click()
    await page
      .locator('#place-errors')
      .getByText(/пк|пикет/iu)
      .first()
      .waitFor()
    await page.locator('#work-place').fill('12+0 – 13+0')
    await button('Применить работу').click()
    await page.getByText('Есть несохранённые изменения').waitFor()
  })
  await step('отмена и повтор', async () => {
    const works = page.locator('section[aria-labelledby="works-title"]')
    await works.getByText(kindName).first().waitFor()
    await button('Отменить · Ctrl+Z').click()
    await works.getByText(kindName).first().waitFor({ state: 'detached' })
    await button('Повторить · Ctrl+Y').click()
    await works.getByText(kindName).first().waitFor()
  })
  const planPath = join(files, 'План 2027.ppr.json')
  await step('сохранение, повторное открытие и файл текущего формата', async () => {
    await save(app, planPath)
    await button('Сохранить · Ctrl+S').click()
    await status('План сохранён.').waitFor()
    const saved = JSON.parse(await readFile(planPath, 'utf8'))
    assert.equal(saved.format.appVersion, version)
    assert.equal(saved.plan.works.length, 1)
    await open(app, [planPath])
    await button('Открыть план').click()
    await page.getByText('Изменения сохранены').waitFor()
    await page
      .locator('section[aria-labelledby="works-title"]')
      .getByText(kindName)
      .first()
      .waitFor()
  })
  await step('PDF текущего листа ПД: А3, встроенные шрифты', async () => {
    const pd = await page
      .locator('#plan-area option')
      .evaluateAll((options) => options.map((o) => o.value).find((v) => v.startsWith('pd:')))
    assert.ok(pd, 'В плане нет ПД')
    await page.locator('#plan-area').selectOption(pd)
    const pdf = join(files, 'Лист ПД.pdf')
    const export_ = button('Сохранить текущий лист в PDF')
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent?.includes('Сохранить текущий лист в PDF') && !b.disabled,
        ),
      undefined,
      { timeout: TIMEOUT },
    )
    await save(app, pdf)
    await export_.click()
    await status(/PDF листа \d+ сохранён/u).waitFor()
    await assertA3(pdf, 1)
  })
  await step('PDF всех ПД: один файл и файл на каждый ПД', async () => {
    const all = join(files, 'Все ПД.pdf')
    await save(app, all)
    await button('Все ПД в один PDF').click()
    const saved = status(/PDF сохранён: листов \d+/u)
    await saved.waitFor()
    const pages = Number(/листов (\d+)/u.exec(await saved.innerText())?.[1])
    assert.ok(pages >= 4, `Листов ${pages}, а ПД в плане четыре`)
    await assertA3(all, pages)
    const folder = join(files, 'По ПД')
    await mkdir(folder)
    await open(app, [folder])
    await button('Все ПД в PDF по файлам').click()
    await status(/PDF сохранены: файлов 4, листов \d+/u).waitFor()
    const written = (await readdir(folder)).filter((name) => name.endsWith('.pdf'))
    assert.equal(written.length, 4)
  })
  await step('файл плана более новой версии не открывается и не перезаписывается', async () => {
    const future = join(files, 'Будущий.ppr.json')
    const text = '{"format":{"version":999,"appVersion":"99.0.0"},"plan":{}}'
    await writeFile(future, text)
    await open(app, [future])
    await button('Открыть план').click()
    await page.getByRole('alert').filter({ hasText: /нов/iu }).first().waitFor()
    assert.equal(await readFile(future, 'utf8'), text)
    await page.getByText('Изменения сохранены').waitFor()
  })
  await step('после аварийного завершения автокопия восстанавливается и сохраняется', async () => {
    await page.locator('#plan-area').selectOption('district')
    await page.locator('#work-kind').selectOption('ТС-001')
    await page.locator('#work-mode').selectOption('line')
    await page.locator('#work-line').selectOption({ label: 'Главный путь Северная-Южная, 1' })
    await page.locator('#work-place').fill('14+0 – 15+0')
    await button('Применить работу').click()
    await page.getByText('Есть несохранённые изменения').waitFor()
    // Автокопия пишется раз в минуту; ждём файл, а не фиксированное время.
    const autosave = `${planPath}.autosave`
    const deadline = Date.now() + 90_000
    while (
      !(await stat(autosave).then(
        () => true,
        () => false,
      ))
    ) {
      assert.ok(Date.now() < deadline, 'Автокопия не появилась за 90 с')
      await new Promise((done) => setTimeout(done, 1000))
    }
    await crash(app)
    ;({ app, page } = await launch())
    await nav('Годовой план').click()
    await open(app, [planPath])
    await button('Открыть план').click()
    await button('Восстановить автокопию').waitFor()
    const main = JSON.parse(await readFile(planPath, 'utf8'))
    assert.equal(main.plan.works.length, 1, 'Основной файл не меняется до решения составителя')
    await button('Восстановить автокопию').click()
    await button('Сохранить · Ctrl+S').click()
    await status('План сохранён.').waitFor()
    const restored = JSON.parse(await readFile(planPath, 'utf8'))
    assert.equal(restored.plan.works.length, 2, 'Восстановленная работа сохраняется в файл')
    // Повторная запись того же файла оставляет рядом копию прежней версии.
    const backup = JSON.parse(await readFile(`${planPath}.bak`, 'utf8'))
    assert.equal(backup.plan.works.length, 1)
  })

  const snapshots = snapshotStore({ root, output })
  // Снимок листа после загрузки шрифтов. Лист в просмотре 60 % целиком помещается в окно;
  // на время снимка он поднимается поверх страницы, чтобы прокрутка и соседние блоки не
  // попадали в кадр. Стиль задаётся через CSSOM: строгая CSP не пропускает вставку <style>.
  const shoot = async (name) => {
    await page.evaluate(() => document.fonts.ready)
    const sheet = page.locator('eow-sheet-a3 svg').first()
    await sheet.waitFor()
    await sheet.evaluate((svg) => {
      Object.assign(svg.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        zIndex: '2147483647',
        background: '#fff',
      })
    })
    try {
      // Целые пиксели внутри листа: дробная ширина SVG иначе захватывает край страницы.
      const box = await sheet.boundingBox()
      assert.ok(box, `Лист ${name} не виден`)
      const clip = { x: 0, y: 0, width: Math.floor(box.width), height: Math.floor(box.height) }
      await snapshots.compare(name, await page.screenshot({ clip, animations: 'disabled' }))
    } finally {
      await sheet.evaluate((svg) => svg.removeAttribute('style'))
    }
  }
  const pages = async (prefix, label) => {
    const counter = status(/^Лист \d+ из \d+$/u).first()
    await counter.waitFor()
    const total = Number(/из (\d+)/u.exec(await counter.innerText())?.[1])
    assert.ok(total >= 1, `${label}: нет листов`)
    for (let n = 1; n <= total; n++) {
      await status(`Лист ${n} из ${total}`).waitFor()
      await shoot(`${prefix}-${n}`)
      if (n < total) await button('Следующий лист').click()
    }
  }
  await step('эталонные снимки листов ПД и общей схемы', async () => {
    const pds = await page
      .locator('#plan-area option')
      .evaluateAll((options) => options.map((o) => o.value).filter((v) => v.startsWith('pd:')))
    for (const [i, pd] of pds.entries()) {
      await page.locator('#plan-area').selectOption(pd)
      await page.locator('#editor-sheet-zoom').fill('0.6')
      await pages(`pd-${i + 1}`, pd)
    }
    await nav('Схема А3').click()
    await page.locator('#sheet-zoom').fill('0.6')
    await pages('overview', 'Схема А3')
    await nav('Годовой план').click()
    snapshots.verify()
    if (snapshots.missing.length)
      console.log(
        `  Эталонов для ${process.platform} нет (${snapshots.missing.length}); снимки — в test-results/e2e/snapshots`,
      )
  })
  await mkdir(output, { recursive: true })
  const report = {
    status: 'passed',
    version,
    platform: process.platform,
    steps,
    snapshots: { checked: snapshots.checked, missing: snapshots.missing },
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (app) await crash(app)
  // EOW_E2E_KEEP=1 оставляет временную папку с базой и книгами для разбора падения.
  if (process.env['EOW_E2E_KEEP'] === '1') console.log(`Рабочая папка сохранена: ${work}`)
  else await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

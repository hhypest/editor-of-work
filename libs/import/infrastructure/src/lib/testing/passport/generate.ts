import { webForms } from './web-forms'
import { renderFramesetXls, renderWebXls } from './web-xls'
import {
  crossingsGeneral,
  crossingsOperational,
  crossingsTechnical,
  stationTracksReport,
  switchesReport,
} from './xlsx-forms'

/** Файл фикстуры: путь относительно папки фикстур и содержимое. */
export interface FixtureFile {
  readonly path: string
  /** Какая форма ЕК АСУИ лежит в файле; импорт должен узнать её по шапке. */
  readonly form: string
  readonly bytes: Uint8Array
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/**
 * Вымышленные выгрузки всех 17 форм паспорта (ADR-0008): 12 «веб-страничных» xls,
 * 3 книги переездов и 2 отчёта BEx. Плюс одна форма в варианте frameset с папкой `.files`.
 * Содержимое детерминировано: одинаковый вызов даёт одинаковые данные.
 */
export async function generatePassportFixtures(): Promise<FixtureFile[]> {
  const files: FixtureFile[] = webForms().map((f) => ({
    path: f.file,
    form: f.form,
    bytes: utf8(renderWebXls(f.table)),
  }))
  const okato = webForms().find((f) => f.form === 'okato')
  if (okato) {
    for (const [path, text] of Object.entries(renderFramesetXls('90000199', okato.table))) {
      files.push({ path: `frameset/${path}`, form: 'okato', bytes: utf8(text) })
    }
  }
  files.push(
    {
      path: 'Переезды общие данные.XLSX',
      form: 'crossings-general',
      bytes: await crossingsGeneral(),
    },
    {
      path: 'Переезды технические данные.XLSX',
      form: 'crossings-technical',
      bytes: await crossingsTechnical(),
    },
    {
      path: 'Переезды эксплуатационные характеристики.XLSX',
      form: 'crossings-operational',
      bytes: await crossingsOperational(),
    },
    {
      path: 'Экспликация станционных путей.xlsx',
      form: 'station-tracks',
      bytes: await stationTracksReport(),
    },
    {
      path: 'Экспликация стрелочных переводов.xlsx',
      form: 'switches',
      bytes: await switchesReport(),
    },
  )
  return files
}

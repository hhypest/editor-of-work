import type { DrawingColor, SchemeDrawing } from '../scheme-drawing'

/**
 * Вымышленная схема станции в единицах схемы ЕК АСУИ: междупутье 160, толщина пути 10.
 * Одни и те же команды превращаются в «чертёж» для тестов распознавания и в PDF
 * для тестов читалки (инфраструктура). Реальные схемы в репозиторий не попадают.
 */
export type SchemeCommand =
  | {
      readonly kind: 'line'
      readonly points: readonly (readonly [number, number])[]
      readonly width: number
      readonly color: DrawingColor
      readonly dash?: readonly number[]
    }
  | {
      readonly kind: 'text'
      readonly text: string
      readonly x: number
      readonly y: number
      readonly size: number
      readonly color: DrawingColor
      /** Градусы, ось y вниз: −90 — снизу вверх. */
      readonly angle?: number
    }

export interface FictionalScheme {
  /** Пунктов листа в одной единице схемы. */
  readonly scale: number
  readonly offset: readonly [number, number]
  readonly width: number
  readonly height: number
  readonly commands: readonly SchemeCommand[]
}

/** Ширина знака вымышленного шрифта, доля кегля. */
export const FICTIONAL_GLYPH_WIDTH = 0.6

export const RED: DrawingColor = [1, 0, 0]
export const BLACK: DrawingColor = [0, 0, 0]
export const BLUE: DrawingColor = [0, 0, 1]
export const GREY: DrawingColor = [0.412, 0.412, 0.412]

const line = (
  points: readonly (readonly [number, number])[],
  width: number,
  color: DrawingColor,
  dash?: readonly number[],
): SchemeCommand =>
  dash ? { kind: 'line', points, width, color, dash } : { kind: 'line', points, width, color }
const text = (
  value: string,
  x: number,
  y: number,
  size: number,
  color: DrawingColor = BLACK,
  angle = 0,
): SchemeCommand => ({ kind: 'text', text: value, x, y, size, color, angle })
const track = (points: readonly (readonly [number, number])[], color = BLACK): SchemeCommand =>
  line(points, 10, color)

/**
 * Станция «Озёрная»: главный I, путь 2 со съездом на главный, тупиковый путь 3 с упором
 * и остряком, закрытый путь 4, подъездной путь без номера, переезд и мост на главном пути.
 */
export function fictionalScheme(): FictionalScheme {
  const commands: SchemeCommand[] = [
    text('ст.Озёрная', 2500, 300, 280),
    // Главный путь проходит через стрелки 1, 3, 5, 2 и 7.
    track(
      [
        [0, 1000],
        [1500, 1000],
        [2000, 1000],
        [3200, 1000],
        [4500, 1000],
        [5200, 1000],
        [6000, 1000],
      ],
      RED,
    ),
    // Путь 2 начинается и кончается ответвлениями от главного; на нём стрелки 4 и 6.
    track([
      [1500, 1000],
      [1700, 840],
    ]),
    track([
      [1700, 840],
      [3000, 840],
      [4000, 840],
      [4300, 840],
    ]),
    track([
      [4300, 840],
      [4500, 1000],
    ]),
    // Съезд 4–5 с пути 2 на главный.
    track([
      [3000, 840],
      [3200, 1000],
    ]),
    // Тупиковый путь 3 с упором.
    track([
      [2000, 1000],
      [2200, 1160],
      [3800, 1160],
    ]),
    line(
      [
        [3812, 1120],
        [3800, 1120],
        [3800, 1200],
        [3812, 1200],
      ],
      4,
      BLACK,
    ),
    // Закрытый для движения путь 4: серый с косыми штрихами.
    track(
      [
        [4000, 840],
        [4200, 680],
        [5300, 680],
      ],
      GREY,
    ),
    // Подъездной путь без номера.
    track([
      [5200, 1000],
      [5400, 1160],
      [5900, 1300],
    ]),
    // Подписи путей: номер, длина, вместимость.
    text('I', 2500, 1020, 91, RED),
    text('863', 2580, 1020, 91, RED),
    text('58', 2800, 1020, 91, BLUE),
    text('2', 2300, 860, 91),
    text('849', 2380, 860, 91),
    text('56', 2600, 860, 91, BLUE),
    text('3', 2900, 1180, 91),
    text('412', 2980, 1180, 91),
    text('4', 4600, 700, 91),
    // Подписи стрелок.
    text('1', 1420, 1080, 78),
    text('3', 1960, 1090, 78),
    text('5 ав', 3200, 1090, 78),
    text('2 ав', 4520, 1090, 78),
    text('7', 5200, 1090, 78),
    text('4', 2950, 800, 78),
    text('6', 3950, 800, 78),
    // Сбрасывающий остряк на пути 3.
    line(
      [
        [2600, 1130],
        [2600, 1190],
      ],
      6,
      BLACK,
    ),
    line(
      [
        [2600, 1160],
        [2720, 1280],
      ],
      6,
      BLACK,
    ),
    text('8со ав', 2640, 1230, 50),
    // Изолирующий стык поперёк главного пути не касается линии концами.
    line(
      [
        [1200, 970],
        [1200, 1030],
      ],
      6,
      BLACK,
    ),
    // Переезд: штрихпунктирная ось и подпись снизу вверх.
    line(
      [
        [5000, 600],
        [5000, 1400],
      ],
      8,
      BLACK,
      [120, 40, 8, 40],
    ),
    text('переезд 12км 3пк', 5060, 1380, 91, BLACK, -90),
    // Мост: прямоугольник с фермой на главном пути.
    line(
      [
        [600, 975],
        [900, 975],
        [900, 1025],
        [600, 1025],
        [600, 975],
      ],
      6,
      BLACK,
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      line(
        [
          [600 + i * 50, i % 2 ? 1025 : 975],
          [650 + i * 50, i % 2 ? 975 : 1025],
        ],
        6,
        BLACK,
      ),
    ),
    // Условные обозначения внизу листа.
    text('Условные обозначения путей:', 200, 1700, 100),
    line(
      [
        [200, 1760],
        [800, 1760],
      ],
      2,
      RED,
    ),
  ]
  // Косые штрихи закрытого пути — короткие отрезки той же толщины.
  for (let x = 4250; x < 5300; x += 25)
    commands.push(
      line(
        [
          [x, 683],
          [x + 3, 677],
        ],
        10,
        GREY,
      ),
    )
  return { scale: 0.2, offset: [20, 40], width: 1300, height: 420, commands }
}

/** Тот же лист как результат чтения PDF: пункты листа, ось y вниз. */
export function fictionalDrawing(scheme: FictionalScheme = fictionalScheme()): SchemeDrawing {
  const { scale, offset } = scheme
  const at = (x: number, y: number) => ({ x: offset[0] + x * scale, y: offset[1] + y * scale })
  const paths: SchemeDrawing['paths'][number][] = []
  const texts: SchemeDrawing['texts'][number][] = []
  for (const c of scheme.commands) {
    if (c.kind === 'line') {
      paths.push({
        subpaths: [c.points.map(([x, y]) => at(x, y))],
        stroke: c.color,
        fill: null,
        width: c.width * scale,
        dash: (c.dash ?? []).map((d) => d * scale),
      })
      continue
    }
    const value = c.text.trim()
    texts.push({
      text: value,
      origin: at(c.x, c.y),
      angle: ((c.angle ?? 0) * Math.PI) / 180,
      size: c.size * scale,
      width: value.length * FICTIONAL_GLYPH_WIDTH * c.size * scale,
      color: c.color,
    })
  }
  return { width: scheme.width, height: scheme.height, paths, texts }
}

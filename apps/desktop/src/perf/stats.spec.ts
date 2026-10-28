import { goals, limitFailures, summarize, type ProfileTimings } from './stats'

const timing = (median: number, p95 = median, max = p95) => ({ count: 3, median, p95, max })

function profile(overrides: Partial<ProfileTimings> = {}): ProfileTimings {
  return {
    id: 'typical',
    title: 'Типовой',
    size: { pds: 10, works: 300, stations: 30, fileBytes: 1000, pages: 30 },
    openMs: timing(20),
    sheetMs: timing(5),
    editMs: timing(8),
    afterEditMs: timing(4),
    batchMs: timing(40),
    saveMs: timing(30),
    ...overrides,
  }
}

describe('Сводка замеров', () => {
  it('медиана, 95-й процентиль по ближайшему рангу и максимум', () => {
    expect(summarize([5, 1, 3])).toEqual({ count: 3, median: 3, p95: 5, max: 5 })
    expect(summarize([4, 1, 3, 2])).toEqual({ count: 4, median: 2.5, p95: 4, max: 4 })
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(summarize(twenty)).toMatchObject({ median: 10.5, p95: 19, max: 20 })
    expect(summarize([1.234])).toEqual({ count: 1, median: 1.2, p95: 1.2, max: 1.2 })
    expect(() => summarize([])).toThrow('Нет замеров')
  })

  it('падает только при крупной регрессии и называет профиль и показатель', () => {
    expect(limitFailures(profile())).toEqual([])
    // Цель 200 мс не порог CI: 500 мс на медленной машине ещё не регрессия.
    expect(limitFailures(profile({ afterEditMs: timing(300, 500) }))).toEqual([])
    expect(
      limitFailures(
        profile({
          afterEditMs: timing(300, 2500),
          batchMs: timing(31_000),
          openMs: timing(20, 20, 16_000),
        }),
      ),
    ).toEqual([
      'Типовой: открытие 16000 мс',
      'Типовой: лист после правки p95 2500 мс',
      'Типовой: все ПД 1033 мс на лист (30 листов)',
    ])
  })

  it('цели приёмки: лист после правки быстрее 200 мс, 30 листов быстрее 30 с', () => {
    expect(goals(profile())).toEqual({ afterEdit: true, batch30: true })
    expect(goals(profile({ afterEditMs: timing(150, 200), batchMs: timing(30_000) }))).toEqual({
      afterEdit: false,
      batch30: false,
    })
    // Цель 30 с относится только к пакету из 30 листов.
    expect(goals(profile({ size: { ...profile().size, pages: 67 } })).batch30).toBeNull()
  })
})

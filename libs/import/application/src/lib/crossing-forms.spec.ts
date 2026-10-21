import { parseCrossingPlace, parseCrossingTitle } from './crossing-forms'
import { directionKey } from './station-check'
import { switchNumber } from './station-forms'

describe('Привязка переезда из названия', () => {
  it.each([
    ['38км2пк', { km: 38, pk: 2, siding: null }],
    ['411 км2пк', { km: 411, pk: 2, siding: null }],
    ['257км 10пк', { km: 257, pk: 10, siding: null }],
    ['ш.Горняк 1км10пк', { km: 1, pk: 10, siding: 'ш.Горняк' }],
  ])('«%s»', (text, place) => {
    expect(parseCrossingPlace(text)).toEqual(place)
  })

  it('полное название: станция, номер и привязка; номер не принимается за ветку', () => {
    expect(parseCrossingTitle('Переезд на станции ОЗЕРНАЯ № 12 15км3пк')).toEqual({
      station: 'ОЗЕРНАЯ',
      number: '12',
      place: { km: 15, pk: 3, siding: null },
    })
    expect(parseCrossingTitle('Переезд на станции ЛЕСНАЯ № 5 ш.Рудник 1км10пк').place).toEqual({
      km: 1,
      pk: 10,
      siding: 'ш.Рудник',
    })
    expect(parseCrossingTitle('Переезд без привязки').place).toBeNull()
  })
})

describe('Названия в станционных выгрузках', () => {
  it('номер стрелки из «Стрелочный перевод № 1, на станции …»', () => {
    expect(switchNumber('Стрелочный перевод № 1, на станции ОЗЕРНАЯ')).toBe('1')
    expect(switchNumber('Стрелочный перевод № 7СО, на станции ОЗЕРНАЯ')).toBe('7СО')
    expect(switchNumber(null)).toBeNull()
  })

  it('направление книги переездов и главный путь — один ключ', () => {
    expect(directionKey('Главный путь Северная-Южная, 1')).toBe(directionKey('СЕВЕРНАЯ-ЮЖНАЯ'))
  })
})

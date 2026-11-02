import { layoutNumberKey, layoutSwitchKey } from './station-layout'

describe('Номера объектов раскладки', () => {
  it('сравнивает номера путей без регистра и пробелов', () => {
    expect(layoutNumberKey(' ii Сев ')).toBe(layoutNumberKey('IIСЕВ'))
    expect(layoutNumberKey('Іа')).toBe('IА')
  })
  it('отбрасывает у стрелки «ав», «р», «п» и оставляет «со» и прочие буквы', () => {
    for (const same of ['15', '15р', '15 ав', '15рп', '15П'])
      expect(layoutSwitchKey(same)).toBe('15')
    expect(layoutSwitchKey('8со ав')).toBe('8СО')
    expect(layoutSwitchKey('8рсо')).toBe('8СО')
    expect(layoutSwitchKey('1а')).toBe('1А')
    expect(layoutSwitchKey('нет')).toBe('НЕТ')
  })
})

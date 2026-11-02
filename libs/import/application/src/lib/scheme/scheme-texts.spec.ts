import { describe, expect, it } from 'vitest'
import { objectLabel } from './scheme-texts'

describe('Подписи стрелок и остряков', () => {
  it('отбрасывает «ав» — автовозврат — с пробелом и без', () => {
    expect(objectLabel('13 ав')).toEqual({ kind: 'switch', number: '13' })
    expect(objectLabel('5ав')).toEqual({ kind: 'switch', number: '5' })
  })

  it('считает остряком только подпись с «со»', () => {
    expect(objectLabel('8со ав')).toEqual({ kind: 'derailer', number: '8со' })
    expect(objectLabel('4СО')).toEqual({ kind: 'derailer', number: '4со' })
    expect(objectLabel('3рсо')).toEqual({ kind: 'derailer', number: '3со' })
  })

  it('отбрасывает «р» и «п» у номера стрелки', () => {
    expect(objectLabel('15р')).toEqual({ kind: 'switch', number: '15' })
    expect(objectLabel('1п')).toEqual({ kind: 'switch', number: '1' })
  })

  it('не относит «сб» ни к стрелкам, ни к острякам', () => {
    expect(objectLabel('49сб ав')).toEqual({ kind: 'ignored' })
  })

  it('оставляет прочие буквы частью номера стрелки', () => {
    expect(objectLabel('1а')).toEqual({ kind: 'switch', number: '1а' })
  })

  it('не принимает подписи сигналов и путей за стрелки', () => {
    expect(objectLabel('М2')).toBeUndefined()
    expect(objectLabel('Н1')).toBeUndefined()
  })
})

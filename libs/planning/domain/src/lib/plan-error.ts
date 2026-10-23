/** Нарушения правил годового плана (docs/architecture.md, раздел 6.2). */
export type PlanError =
  | { readonly kind: 'invalid-year'; readonly year: number }
  | { readonly kind: 'invalid-approval-year'; readonly year: number }
  | { readonly kind: 'duplicate-basis'; readonly what: BasisPart; readonly id: string }
  | { readonly kind: 'extent-off-line'; readonly line: string }
  | { readonly kind: 'unknown-included-in'; readonly code: string; readonly includedIn: string }
  | { readonly kind: 'self-included-in'; readonly code: string }
  | {
      readonly kind: 'included-in-unit-mismatch'
      readonly code: string
      readonly includedIn: string
      readonly unit: string
      readonly targetUnit: string
    }
  | { readonly kind: 'pd-off-line'; readonly pd: string; readonly line: string }
  | { readonly kind: 'pd-overlap'; readonly a: string; readonly b: string }
  | { readonly kind: 'unknown-pd'; readonly station: string; readonly pd: string }
  | { readonly kind: 'duplicate-work'; readonly id: string }
  | { readonly kind: 'work-not-found'; readonly id: string }
  | { readonly kind: 'unknown-work-kind'; readonly code: string }
  | { readonly kind: 'unknown-line'; readonly line: string }
  | { readonly kind: 'unknown-station'; readonly station: string }
  | { readonly kind: 'unknown-track'; readonly station: NamedRef; readonly number: string }
  | { readonly kind: 'unknown-switch'; readonly station: NamedRef; readonly number: string }
  | { readonly kind: 'empty-place' }
  | { readonly kind: 'station-required' }
  | { readonly kind: 'outside-line'; readonly line: NamedRef; readonly place: string }
  | { readonly kind: 'invalid-volume'; readonly volume: number }
  | { readonly kind: 'volume-required'; readonly code: string; readonly unit: string }
  /** area — подпись для текста: «ПД «ПД-9»», «Станция «S9»». */
  | { readonly kind: 'unknown-area'; readonly area: string }
  | { readonly kind: 'invalid-manual-value'; readonly value: number }
  | { readonly kind: 'invalid-indicator'; readonly reason: 'id' | 'name' | 'value' | 'limit' }

export type BasisPart = 'line' | 'station' | 'pd' | 'work-kind'

/** Идентификатор и название объекта редакции: название идёт в текст ошибки. */
export interface NamedRef {
  readonly id: string
  readonly name: string
}

const BASIS_PART: Record<BasisPart, string> = {
  line: 'Направление',
  station: 'Станция',
  pd: 'ПД',
  'work-kind': 'Вид работ',
}

/** Текст ошибки для пользователя. */
export function describePlanError(e: PlanError): string {
  switch (e.kind) {
    case 'invalid-indicator':
      return {
        id: 'Идентификаторы показателей должны быть непустыми и уникальными в области',
        name: 'Укажите наименование каждого показателя',
        value: 'Значение показателя должно быть конечным числом',
        limit: 'В одной области допускается не более 10 000 показателей',
      }[e.reason]
    case 'invalid-year':
      return `Год плана должен быть целым числом от 2000 до 2100, а не ${e.year}`
    case 'invalid-approval-year':
      return `Год утверждения должен быть целым числом от 1999 до 2100, а не ${e.year}`
    case 'duplicate-basis':
      return `${BASIS_PART[e.what]} «${e.id}» встречается в редакции дважды`
    case 'extent-off-line':
      return `Протяжение направления «${e.line}» задано участками другого направления`
    case 'unknown-included-in':
      return `Вид работ «${e.code}» входит в неизвестный вид «${e.includedIn}»`
    case 'self-included-in':
      return `Вид работ «${e.code}» не может входить сам в себя`
    case 'included-in-unit-mismatch':
      return `Вид работ «${e.code}» (${e.unit}) не может входить в «${e.includedIn}» (${e.targetUnit}): единицы различаются`
    case 'pd-off-line':
      return `Граница ${e.pd} лежит на неизвестном направлении «${e.line}»`
    case 'pd-overlap':
      return e.a === e.b
        ? `Границы внутри ${e.a} перекрываются`
        : `Границы ${e.a} и ${e.b} перекрываются`
    case 'unknown-pd':
      return `Станция «${e.station}» отнесена к неизвестному ПД «${e.pd}»`
    case 'duplicate-work':
      return `Работа ${e.id} уже есть в плане`
    case 'work-not-found':
      return `Работы ${e.id} нет в плане`
    case 'unknown-work-kind':
      return `Вида работ «${e.code}» нет в редакции паспорта плана`
    case 'unknown-line':
      return `Направления «${e.line}» нет в редакции паспорта плана`
    case 'unknown-station':
      return `Станции «${e.station}» нет в редакции паспорта плана`
    case 'unknown-track':
      return `На станции «${e.station.name}» нет пути № ${e.number}`
    case 'unknown-switch':
      return `На станции «${e.station.name}» нет стрелочного перевода № ${e.number}`
    case 'empty-place':
      return 'Укажите место работы: участки на направлении или станцию'
    case 'station-required':
      return 'Привязка работы к пути или стрелке требует станции'
    case 'outside-line':
      return `${e.place} — вне протяжения направления «${e.line.name}» в дистанции`
    case 'invalid-volume':
      return `Объём должен быть неотрицательным числом, а не ${e.volume}`
    case 'volume-required':
      return `Укажите объём: для вида «${e.code}» в единицах «${e.unit}» он не считается по участкам`
    case 'unknown-area':
      return `${e.area} нет в редакции паспорта плана`
    case 'invalid-manual-value':
      return `Значение должно быть неотрицательным числом, а не ${e.value}`
  }
}

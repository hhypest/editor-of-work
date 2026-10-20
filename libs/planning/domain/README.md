# planning-domain

`@eow/planning/domain` · контекст «Планирование ППР» · теги `type:domain`, `scope:planning`

Домен: агрегаты, объекты-значения, доменные сервисы. Чистый TypeScript — без Angular, RxJS, Node, Electron, SQLite и DOM.

Срез редакции отклоняет перекрывающиеся границы, в том числе внутри одного ПД.
Смежные участки разрешены. Связь вида работ «входит в» допускается только с другим
существующим видом с той же единицей измерения (пробелы по краям не учитываются).
Неверные данные возвращаются как `PlanError` с пояснением для пользователя.

Правила границ — [docs/architecture.md, раздел 11](../../../docs/architecture.md) и [ADR-0001](../../../docs/adr/0001-clean-architecture-ddd.md).

```bash
npx nx test planning-domain
npx nx lint planning-domain
npx nx typecheck planning-domain
```

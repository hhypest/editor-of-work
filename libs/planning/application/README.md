# planning-application

`@eow/planning/application` · контекст «Планирование ППР» · теги `type:application`, `scope:planning`

Слой приложения: сценарии и интерфейсы портов. Знает только домен и ядро.

Правила границ — [docs/architecture.md, раздел 11](../../../docs/architecture.md) и [ADR-0001](../../../docs/adr/0001-clean-architecture-ddd.md).

```bash
npx nx test planning-application
npx nx lint planning-application
npx nx typecheck planning-application
```

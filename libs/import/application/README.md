# import-application

`@eow/import/application` · контекст «Импорт выгрузок (антикоррупционный слой)» · теги `type:application`, `scope:import`

Слой приложения: сценарии и интерфейсы портов. Знает только домен и ядро.

Правила границ — [docs/architecture.md, раздел 11](../../../docs/architecture.md) и [ADR-0001](../../../docs/adr/0001-clean-architecture-ddd.md).

```bash
npx nx test import-application
npx nx lint import-application
npx nx typecheck import-application
```

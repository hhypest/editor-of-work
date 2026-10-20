# passport-infrastructure

`@eow/passport/infrastructure` · контекст «Паспорт дистанции» · теги `type:infrastructure`, `scope:passport`

Инфраструктура: реализации портов (адаптеры). Не импортирует UI.

`openPortablePassport` выбирает расположение базы, а `openPassportDatabase`
открывает путь, выбранный main. Адаптер `PassportStore` использует Kysely и
встроенный `node:sqlite`: SQL-миграции, WAL, внешние ключи, резервные копии
и транзакционная смена редакций. Подробности —
[хранение паспорта](../../../docs/passport-storage.md).

Правила границ — [docs/architecture.md, раздел 11](../../../docs/architecture.md) и [ADR-0001](../../../docs/adr/0001-clean-architecture-ddd.md).

```bash
npx nx test passport-infrastructure
npx nx lint passport-infrastructure
npx nx typecheck passport-infrastructure
```

# История изменений

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).

## [Не выпущено]

### Добавлено

- Каркас монорепозитория Nx: приложение `apps/ui` (Angular 22, без zone.js) и 20 библиотек по контекстам и слоям с тегами `type:` и `scope:`; правила границ модулей проверяются ESLint (#2).
- Приложение `apps/desktop` на Electron 44: main, preload с единственным объектом `window.eow`, отдача интерфейса по схеме `app://ui` с CSP, запрет навигации, новых окон и разрешений, один экземпляр программы; типизированный IPC-контракт `libs/ipc/contracts` с проверкой запросов и ответов zod в main (#3).
- Качество кода: строгие настройки TypeScript для всего репозитория (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` и др.), ESLint с типизированными правилами и правилами Angular, oxlint, Prettier; команды `lint`, `lint:fix`, `format`, `format:check`, `typecheck` и сводная `npm run check` (#4).
- CI GitHub Actions на Ubuntu и Windows (Node 24): `npm run check` на каждый PR и push в `main`; проверка `check:public` (в индексе нет выгрузок, баз, планов, PDF и архивов) и `check:licenses` (лицензии зависимостей, попадающих в exe) (#5).
- Архитектурный документ (`docs/architecture.md`) и ADR 0001–0008.
- README, правила разработки (`CONTRIBUTING.md`), правила для ИИ-агентов (`AGENTS.md`), лицензия MIT.
- Служебные файлы репозитория: `.gitignore`, `.gitattributes`, `.editorconfig`, шаблон pull request.

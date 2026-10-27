# Переносная сборка

Один exe без установки для Windows 10/11 x64 ([ADR-0042](adr/0042-portable-build.md), #6). Сборку и выпуск запускает только владелец репозитория; ни push, ни тег их не запускают.

## Сборка в GitHub Actions

1. Actions → **Portable exe** → **Run workflow**, ветка `main`.
2. Флажок «Создать черновик Release» оставьте снятым, если нужен только exe для проверки. С флажком после всех проверок появится черновик `v<версия>` с exe и SHA-256; версия с суффиксом (`0.5.0-beta.1`) помечается как предварительная. Публикует черновик только владелец.
3. Workflow на windows-latest выполняет `npm run check`, `check:electron`, сборку exe, сквозной сценарий в упакованной программе и запуск самого exe. Exe, файл `.sha256` и отчёты — в артефакте `portable-exe` (30 дней).

## Сборка на своём ПК с Windows

```
npm ci
npm run package:portable
```

Результат — `dist/release/editor-of-work-<версия>-portable.exe` и рядом `…portable.exe.sha256`. Проверка, как в workflow:

```
$env:EOW_E2E_EXECUTABLE="dist/release/win-unpacked/editor-of-work.exe"; npm run test:e2e
node scripts/smoke-portable.mjs
```

`npm run package:portable -- --dir` собирает только распакованную программу для текущей ОС (без exe) — для проверки состава.

## Перенос на рабочий ПК

1. Скопируйте exe и файл `.sha256`.
2. Сверьте сумму в PowerShell: `Get-FileHash .\editor-of-work-<версия>-portable.exe -Algorithm SHA256` — значение должно совпасть с первой частью строки в `.sha256` (регистр букв не важен).
3. Положите exe в отдельную папку, например на флешку. При первом запуске рядом появится `data` с базой паспорта; переносите программу вместе с этой папкой.

Если папка exe недоступна для записи, база создаётся в `%LOCALAPPDATA%\editor-of-work`; если найдены обе базы, программа спросит, какую открыть ([хранилище](passport-storage.md)).

## Что внутри

Собранные main и preload, интерфейс в `resources/ui`, лицензии в `resources/licenses`, Electron из lock-файла. Программа не обращается к сети: автообновления нет, шрифты встроены. Exe без иконки и цифровой подписи — Windows может показать предупреждение SmartScreen при первом запуске.

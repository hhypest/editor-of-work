import nx from '@nx/eslint-plugin'
import oxlint from 'eslint-plugin-oxlint'
import prettier from 'eslint-config-prettier'
import { fileURLToPath } from 'node:url'

/**
 * Границы модулей: docs/architecture.md, раздел 11; ADR-0001.
 * Ограничения складываются: импорт должен пройти все, под которые подходит библиотека.
 */

/** Внешние пакеты, которых не должно быть в чистых слоях (ядро, домен, приложение). */
const frameworkAndIo = [
  '@angular/*',
  'rxjs',
  'rxjs/*',
  'electron',
  'node:*',
  'fs',
  'path',
  'os',
  'child_process',
  'zod',
  'better-sqlite3',
  'kysely',
  'exceljs',
  'node-html-parser',
  'pdf-lib',
]
/** Пакеты, доступные только main-процессу. */
const mainProcessOnly = ['electron', 'node:*', 'fs', 'path', 'better-sqlite3', 'kysely', 'exceljs']

/** Слой (type:) — от каких слоёв может зависеть библиотека и какие внешние пакеты ей запрещены. */
const layerConstraints = [
  {
    sourceTag: 'type:kernel',
    onlyDependOnLibsWithTags: ['type:kernel'],
    bannedExternalImports: frameworkAndIo,
  },
  {
    sourceTag: 'type:domain',
    onlyDependOnLibsWithTags: ['type:kernel'],
    bannedExternalImports: frameworkAndIo,
  },
  {
    sourceTag: 'type:application',
    onlyDependOnLibsWithTags: ['type:application', 'type:domain', 'type:kernel'],
    bannedExternalImports: frameworkAndIo,
  },
  {
    sourceTag: 'type:contracts',
    onlyDependOnLibsWithTags: ['type:kernel'],
    bannedExternalImports: ['@angular/*', 'rxjs', 'rxjs/*', ...mainProcessOnly],
  },
  {
    sourceTag: 'type:infrastructure',
    onlyDependOnLibsWithTags: ['type:application', 'type:domain', 'type:kernel', 'type:contracts'],
  },
  {
    sourceTag: 'type:ui-kit',
    onlyDependOnLibsWithTags: ['type:ui-kit', 'type:kernel'],
    bannedExternalImports: mainProcessOnly,
  },
  {
    sourceTag: 'type:feature-ui',
    onlyDependOnLibsWithTags: ['type:application', 'type:kernel', 'type:ui-kit'],
    bannedExternalImports: mainProcessOnly,
  },
  { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['*'] },
]

const contexts = ['passport', 'stations', 'planning', 'import', 'documents']

/** Контекст (scope:) — из каких контекстов разрешены импорты. */
const scopeConstraints = [
  { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
  { sourceTag: 'scope:passport', onlyDependOnLibsWithTags: ['scope:passport', 'scope:shared'] },
  {
    sourceTag: 'scope:stations',
    onlyDependOnLibsWithTags: ['scope:stations', 'scope:passport', 'scope:shared'],
  },
  {
    sourceTag: 'scope:planning',
    onlyDependOnLibsWithTags: ['scope:planning', 'scope:passport', 'scope:shared'],
  },
  {
    sourceTag: 'scope:import',
    onlyDependOnLibsWithTags: ['scope:import', 'scope:passport', 'scope:planning', 'scope:shared'],
  },
  {
    sourceTag: 'scope:documents',
    onlyDependOnLibsWithTags: [
      'scope:documents',
      'scope:passport',
      'scope:planning',
      'scope:stations',
      'scope:shared',
    ],
  },
  { sourceTag: 'scope:ui', onlyDependOnLibsWithTags: ['*'] },
  { sourceTag: 'scope:desktop', onlyDependOnLibsWithTags: ['*'] },
  // Домен контекста не виден другим контекстам: связь только через порты и запросы слоя приложения.
  ...contexts.map((ctx) => ({
    sourceTag: `scope:${ctx}`,
    notDependOnLibsWithTags: contexts
      .filter((other) => other !== ctx)
      .map((other) => `domain:${other}`),
  })),
  // Сценарии планирования и станций получают паспорт через свои порты (PassportView);
  // адаптер к паспорту живёт в инфраструктуре или в composition root.
  ...['planning', 'stations'].map((ctx) => ({
    allSourceTags: ['type:application', `scope:${ctx}`],
    onlyDependOnLibsWithTags: [`scope:${ctx}`, 'scope:shared'],
  })),
]

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vitest.config.*.timestamp*',
      '**/vite.config.*.timestamp*',
    ],
  },
  {
    // Правила качества кода: CONTRIBUTING.md, раздел «TypeScript».
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Правила, которым нужны типы: только исходники библиотек и приложений.
    files: ['{apps,libs}/**/src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          banTransitiveDependencies: true,
          depConstraints: [...layerConstraints, ...scopeConstraints],
        },
      ],
    },
  },
  // Правила, которые уже проверяет oxlint, и форматирование (Prettier) в ESLint выключены.
  ...oxlint.buildFromOxlintConfigFile(fileURLToPath(new URL('./.oxlintrc.json', import.meta.url))),
  prettier,
]

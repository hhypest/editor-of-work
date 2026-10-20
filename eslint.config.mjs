import nx from '@nx/eslint-plugin'
import oxlint from 'eslint-plugin-oxlint'
import prettier from 'eslint-config-prettier'
import { fileURLToPath } from 'node:url'

/**
 * Границы модулей: docs/architecture.md, раздел 11; ADR-0001.
 * Слой (type:) — что может импортировать библиотека этого слоя.
 * Контекст (scope:) — из каких контекстов разрешены импорты.
 */
const layerConstraints = [
  { sourceTag: 'type:kernel', onlyDependOnLibsWithTags: ['type:kernel'] },
  { sourceTag: 'type:domain', onlyDependOnLibsWithTags: ['type:kernel'] },
  {
    sourceTag: 'type:application',
    onlyDependOnLibsWithTags: ['type:application', 'type:domain', 'type:kernel'],
  },
  { sourceTag: 'type:contracts', onlyDependOnLibsWithTags: ['type:kernel'] },
  {
    sourceTag: 'type:infrastructure',
    onlyDependOnLibsWithTags: ['type:application', 'type:domain', 'type:kernel', 'type:contracts'],
  },
  { sourceTag: 'type:ui-kit', onlyDependOnLibsWithTags: ['type:ui-kit', 'type:kernel'] },
  {
    sourceTag: 'type:feature-ui',
    onlyDependOnLibsWithTags: ['type:application', 'type:kernel', 'type:ui-kit'],
  },
  { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['*'] },
]

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
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [...layerConstraints, ...scopeConstraints],
        },
      ],
    },
  },
  // Правила, которые уже проверяет oxlint, и форматирование (Prettier) в ESLint выключены.
  ...oxlint.buildFromOxlintConfigFile(fileURLToPath(new URL('./.oxlintrc.json', import.meta.url))),
  prettier,
]

import nx from '@nx/eslint-plugin';

/**
 * Границы модулей: docs/architecture.md, раздел 11; ADR-0001.
 * Слой (type:) — что может импортировать библиотека этого слоя.
 * Контекст (scope:) — из каких контекстов разрешены импорты.
 */
const layerConstraints = [
  { sourceTag: 'type:kernel', onlyDependOnLibsWithTags: ['type:kernel'] },
  { sourceTag: 'type:domain', onlyDependOnLibsWithTags: ['type:kernel'] },
  { sourceTag: 'type:application', onlyDependOnLibsWithTags: ['type:application', 'type:domain', 'type:kernel'] },
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
];

const scopeConstraints = [
  { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
  { sourceTag: 'scope:passport', onlyDependOnLibsWithTags: ['scope:passport', 'scope:shared'] },
  { sourceTag: 'scope:stations', onlyDependOnLibsWithTags: ['scope:stations', 'scope:passport', 'scope:shared'] },
  { sourceTag: 'scope:planning', onlyDependOnLibsWithTags: ['scope:planning', 'scope:passport', 'scope:shared'] },
  {
    sourceTag: 'scope:import',
    onlyDependOnLibsWithTags: ['scope:import', 'scope:passport', 'scope:planning', 'scope:shared'],
  },
  {
    sourceTag: 'scope:documents',
    onlyDependOnLibsWithTags: ['scope:documents', 'scope:passport', 'scope:planning', 'scope:stations', 'scope:shared'],
  },
  { sourceTag: 'scope:ui', onlyDependOnLibsWithTags: ['*'] },
  { sourceTag: 'scope:desktop', onlyDependOnLibsWithTags: ['*'] },
];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*', '**/vite.config.*.timestamp*'],
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
];

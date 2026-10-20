/**
 * Встроенные модули Node правило границ Nx не проверяет, поэтому в библиотеках,
 * которые не должны знать о Node (ядро, домен, приложение, контракты, UI), они запрещены явно.
 * Подключается в eslint.config.mjs таких библиотек (ADR-0001).
 */
const message = 'Модули Node доступны только инфраструктуре и main-процессу (ADR-0001).'

export default [
  {
    files: ['**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.test.ts', '**/test-setup.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ regex: '^node:', message }],
          paths: ['fs', 'path', 'os', 'child_process', 'crypto', 'url', 'util'].map((name) => ({
            name,
            message,
          })),
        },
      ],
    },
  },
]

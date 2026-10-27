import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/passport/infrastructure',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'passport-infrastructure',
    watch: false,
    passWithNoTests: true,
    globals: true,
    environment: 'node',
    // Тесты создают и мигрируют настоящие базы и файлы: на Windows-раннере CI отдельный
    // тест идёт до 7 с при пределе Vitest 5 с. Запас по времени, а не отключение проверок.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/passport/infrastructure',
      provider: 'v8' as const,
    },
  },
}))

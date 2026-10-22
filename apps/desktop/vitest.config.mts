import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/desktop',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'desktop',
    watch: false,
    passWithNoTests: true,
    globals: true,
    environment: 'node',
    // SQLite backups and xlsx round trips share the CI runner with other Nx projects.
    // Keep desktop integration files sequential to avoid competing for disk and CPU.
    fileParallelism: false,
    include: ['src/**/*.{test,spec}.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/desktop',
      provider: 'v8' as const,
    },
  },
}))

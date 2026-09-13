import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { uta: 'src/main.ts' },
  format: ['esm'],
  outDir: 'dist',
  target: 'es2023',
  sourcemap: true,
  clean: true,
  splitting: false,
  // Bundle only local source (services/uta/src + main-repo src/* pulled in
  // via tsconfig paths). Anything resolved from node_modules stays external
  // — native modules like longbridge / node-pty must not be bundled.
  // Workspace packages (`@traderalice/*`) are also external; the runtime
  // resolver picks the `openalice-source` condition for in-repo dev and the
  // built `dist/` for production.
  skipNodeModulesBundle: true,
  esbuildOptions: (options) => {
    options.conditions = ['openalice-source', ...(options.conditions ?? [])]
  },
})

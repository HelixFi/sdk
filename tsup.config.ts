import { defineConfig } from 'tsup';

// The published build: ESM and CommonJS with their type declarations. @solana/kit stays external (a peer dependency).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  external: ['@solana/kit'],
});

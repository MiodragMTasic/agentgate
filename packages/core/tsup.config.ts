import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	sourcemap: true,
	treeshake: true,
	platform: 'node',
	splitting: false,
	minify: false,
	external: ['yaml'],
});

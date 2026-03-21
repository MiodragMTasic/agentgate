import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/bin/agentgate.ts'],
	format: ['esm'],
	clean: true,
	sourcemap: true,
	banner: { js: '#!/usr/bin/env node' },
	external: ['@agentgate/core'],
});

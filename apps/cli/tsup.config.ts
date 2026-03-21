import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/bin/agentgate.ts'],
	format: ['esm'],
	clean: true,
	sourcemap: true,
	platform: 'node',
	banner: { js: '#!/usr/bin/env node' },
	external: ['@miodragmtasic/agentgate-core', 'yaml'],
});

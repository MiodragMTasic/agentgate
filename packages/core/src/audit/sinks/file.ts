import { appendFile } from 'node:fs/promises';

import type { AuditSink } from '../types.js';

export function fileSink(path: string): AuditSink {
	return {
		name: 'file',
		async write(event) {
			const line = `${JSON.stringify(event)}\n`;
			await appendFile(path, line, 'utf-8');
		},
		async flush() {
			// no-op — each write appends immediately
		},
	};
}

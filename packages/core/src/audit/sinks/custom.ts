import type { AuditEvent, AuditSink } from '../types.js';

export function customSink(
	name: string,
	writeFn: (event: AuditEvent) => void | Promise<void>,
): AuditSink {
	return {
		name,
		write: writeFn,
	};
}

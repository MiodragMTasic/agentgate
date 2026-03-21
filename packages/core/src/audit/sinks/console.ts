import type { AuditSink } from '../types.js';

export function consoleSink(): AuditSink {
	return {
		name: 'console',
		write(event) {
			const prefix = formatPrefix(event.type);
			const ts = event.timestamp.toISOString();
			const line = `${prefix} [${ts}] tool=${event.tool} identity=${event.identity.id} verdict=${event.decision.verdict} (${event.evaluationMs}ms)`;
			if (event.type.startsWith('tool:denied') || event.type.startsWith('budget:exceeded')) {
				console.warn(line);
			} else if (event.type.startsWith('tool:error')) {
				console.error(line);
			} else {
				console.log(line);
			}
		},
	};
}

function formatPrefix(type: string): string {
	const labels: Record<string, string> = {
		'tool:allowed': '[ALLOW]',
		'tool:denied': '[DENY]',
		'tool:pending': '[PENDING]',
		'tool:error': '[ERROR]',
		'approval:requested': '[APPROVAL:REQ]',
		'approval:approved': '[APPROVAL:OK]',
		'approval:denied': '[APPROVAL:DENY]',
		'approval:expired': '[APPROVAL:EXP]',
		'budget:warning': '[BUDGET:WARN]',
		'budget:exceeded': '[BUDGET:OVER]',
		'rate-limit:hit': '[RATE-LIMIT]',
		'policy:reloaded': '[POLICY:RELOAD]',
	};
	return labels[type] ?? `[${type.toUpperCase()}]`;
}

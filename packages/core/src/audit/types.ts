import type { GateDecision, Identity } from '../context/types.js';

export type AuditEventType =
	| 'tool:allowed'
	| 'tool:denied'
	| 'tool:pending'
	| 'tool:error'
	| 'approval:requested'
	| 'approval:approved'
	| 'approval:denied'
	| 'approval:expired'
	| 'budget:warning'
	| 'budget:exceeded'
	| 'rate-limit:hit'
	| 'policy:reloaded';

export interface AuditEvent {
	id: string;
	timestamp: Date;
	type: AuditEventType;
	tool: string;
	identity: Identity;
	decision: GateDecision;
	params?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	evaluationMs: number;
}

export interface AuditSink {
	name: string;
	write(event: AuditEvent): void | Promise<void>;
	flush?(): Promise<void>;
}

import type { AuditEvent, AuditSink } from './types.js';

export interface AuditLoggerConfig {
	logAllowed: boolean;
	redactParams: string[];
}

export class AuditLogger {
	private readonly sinks: AuditSink[];
	private readonly config: AuditLoggerConfig;
	private readonly pendingWrites = new Set<Promise<void>>();

	constructor(sinks: AuditSink[], config: AuditLoggerConfig) {
		this.sinks = sinks;
		this.config = config;
	}

	async log(event: AuditEvent): Promise<void> {
		if (!this.config.logAllowed && event.type === 'tool:allowed') {
			return;
		}

		const redacted = this.redact(event);
		const pending = Promise.all(this.sinks.map((sink) => sink.write(redacted))).then(
			() => undefined,
		);
		this.pendingWrites.add(pending);
		try {
			await pending;
		} finally {
			this.pendingWrites.delete(pending);
		}
	}

	async flush(): Promise<void> {
		if (this.pendingWrites.size > 0) {
			await Promise.all([...this.pendingWrites]);
		}

		const results = this.sinks.flatMap((sink) => (sink.flush ? [sink.flush()] : []));
		await Promise.all(results);
	}

	private redact(event: AuditEvent): AuditEvent {
		if (!event.params || this.config.redactParams.length === 0) {
			return event;
		}

		const redactedParams: Record<string, unknown> = { ...event.params };
		for (const key of this.config.redactParams) {
			if (key in redactedParams) {
				redactedParams[key] = '[REDACTED]';
			}
		}

		return { ...event, params: redactedParams };
	}
}

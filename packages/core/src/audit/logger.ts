import type { AuditEvent, AuditSink } from './types.js';

export interface AuditLoggerConfig {
	logAllowed: boolean;
	redactParams: string[];
}

export class AuditLogger {
	private readonly sinks: AuditSink[];
	private readonly config: AuditLoggerConfig;

	constructor(sinks: AuditSink[], config: AuditLoggerConfig) {
		this.sinks = sinks;
		this.config = config;
	}

	async log(event: AuditEvent): Promise<void> {
		if (!this.config.logAllowed && event.type === 'tool:allowed') {
			return;
		}

		const redacted = this.redact(event);

		const results = this.sinks.map((sink) => sink.write(redacted));
		await Promise.all(results);
	}

	async flush(): Promise<void> {
		const results = this.sinks
			.filter((sink) => sink.flush)
			.map((sink) => sink.flush!());
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

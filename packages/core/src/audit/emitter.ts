export type AuditEmitterEvent = 'decision' | 'approval' | 'budget' | 'rate-limit';

type Handler = (...args: unknown[]) => void;

export class AuditEmitter {
	private readonly listeners = new Map<AuditEmitterEvent, Set<Handler>>();

	on(event: AuditEmitterEvent, handler: Handler): void {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(handler);
	}

	off(event: AuditEmitterEvent, handler: Handler): void {
		this.listeners.get(event)?.delete(handler);
	}

	emit(event: AuditEmitterEvent, data: unknown): void {
		const set = this.listeners.get(event);
		if (!set) return;
		for (const handler of set) {
			handler(data);
		}
	}
}

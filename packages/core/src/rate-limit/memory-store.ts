import type { RateLimitStore, RateLimitStoreEntry } from './types.js';

interface StoredWindow {
	count: number;
	expiresAt: number;
}

type TimerHandle = ReturnType<typeof globalThis.setInterval>;

export class MemoryRateLimitStore implements RateLimitStore {
	private windows = new Map<string, StoredWindow>();
	private cleanupTimer: TimerHandle | null = null;

	constructor(cleanupIntervalMs = 60_000) {
		this.cleanupTimer = globalThis.setInterval(() => this.cleanup(), cleanupIntervalMs);
		// Allow the process to exit without waiting for the timer when supported by the runtime.
		if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
			this.cleanupTimer.unref();
		}
	}

	async increment(key: string, windowMs: number): Promise<RateLimitStoreEntry> {
		const now = Date.now();
		const existing = this.windows.get(key);

		if (existing && existing.expiresAt > now) {
			existing.count += 1;
			return {
				count: existing.count,
				resetsAt: new Date(existing.expiresAt),
			};
		}

		const expiresAt = now + windowMs;
		this.windows.set(key, { count: 1, expiresAt });
		return {
			count: 1,
			resetsAt: new Date(expiresAt),
		};
	}

	async peek(key: string): Promise<RateLimitStoreEntry> {
		const now = Date.now();
		const existing = this.windows.get(key);

		if (existing && existing.expiresAt > now) {
			return {
				count: existing.count,
				resetsAt: new Date(existing.expiresAt),
			};
		}

		return {
			count: 0,
			resetsAt: new Date(now),
		};
	}

	async reset(key: string): Promise<void> {
		this.windows.delete(key);
	}

	destroy(): void {
		if (this.cleanupTimer != null) {
			globalThis.clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}
		this.windows.clear();
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [key, window] of this.windows) {
			if (window.expiresAt <= now) {
				this.windows.delete(key);
			}
		}
	}
}

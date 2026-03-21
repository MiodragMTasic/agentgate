import type { RateLimitResult, RateLimitRule, RateLimitStore } from './types.js';

export class SlidingWindowLimiter {
	private store: RateLimitStore;

	constructor(store: RateLimitStore) {
		this.store = store;
	}

	async check(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
		const entry = await this.store.peek(key);

		const allowed = entry.count < rule.maxRequests;
		return {
			allowed,
			remaining: Math.max(0, rule.maxRequests - entry.count),
			resetsAt: entry.resetsAt,
			rule,
		};
	}

	async increment(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
		const windowMs = rule.windowSeconds * 1_000;
		const entry = await this.store.increment(key, windowMs);

		const allowed = entry.count <= rule.maxRequests;
		return {
			allowed,
			remaining: Math.max(0, rule.maxRequests - entry.count),
			resetsAt: entry.resetsAt,
			rule,
		};
	}
}

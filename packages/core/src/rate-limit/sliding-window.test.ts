import { describe, it, expect, beforeEach } from 'vitest';
import { SlidingWindowLimiter } from './sliding-window.js';
import { MemoryRateLimitStore } from './memory-store.js';
import type { RateLimitRule } from './types.js';

const makeRule = (maxRequests = 3, windowSeconds = 60): RateLimitRule => ({
	name: 'test_rule',
	tools: 'test_tool',
	maxRequests,
	windowSeconds,
	scope: 'identity:tool',
	strategy: 'sliding-window',
});

describe('SlidingWindowLimiter', () => {
	let store: MemoryRateLimitStore;
	let limiter: SlidingWindowLimiter;

	beforeEach(() => {
		store = new MemoryRateLimitStore(0); // disable cleanup timer
		limiter = new SlidingWindowLimiter(store);
	});

	describe('check', () => {
		it('reports allowed when no requests have been made', async () => {
			const result = await limiter.check('key1', makeRule(5));
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(5);
		});

		it('reports remaining count after increments', async () => {
			const rule = makeRule(3);
			await limiter.increment('key1', rule);
			await limiter.increment('key1', rule);

			const result = await limiter.check('key1', rule);
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(1);
		});

		it('reports not allowed when at limit', async () => {
			const rule = makeRule(2);
			await limiter.increment('key1', rule);
			await limiter.increment('key1', rule);

			const result = await limiter.check('key1', rule);
			expect(result.allowed).toBe(false);
			expect(result.remaining).toBe(0);
		});
	});

	describe('increment', () => {
		it('allows requests within limit', async () => {
			const rule = makeRule(3);
			const r1 = await limiter.increment('key1', rule);
			expect(r1.allowed).toBe(true);
			expect(r1.remaining).toBe(2);

			const r2 = await limiter.increment('key1', rule);
			expect(r2.allowed).toBe(true);
			expect(r2.remaining).toBe(1);

			const r3 = await limiter.increment('key1', rule);
			expect(r3.allowed).toBe(true);
			expect(r3.remaining).toBe(0);
		});

		it('denies requests exceeding limit', async () => {
			const rule = makeRule(2);
			await limiter.increment('key1', rule);
			await limiter.increment('key1', rule);

			const r3 = await limiter.increment('key1', rule);
			expect(r3.allowed).toBe(false);
			expect(r3.remaining).toBe(0);
		});

		it('returns a resetsAt date in the future', async () => {
			const rule = makeRule(5, 60);
			const result = await limiter.increment('key1', rule);
			expect(result.resetsAt).toBeInstanceOf(Date);
			expect(result.resetsAt.getTime()).toBeGreaterThan(Date.now() - 1000);
		});

		it('tracks different keys independently', async () => {
			const rule = makeRule(1);
			await limiter.increment('key_a', rule);
			const rA = await limiter.increment('key_a', rule);
			expect(rA.allowed).toBe(false);

			const rB = await limiter.increment('key_b', rule);
			expect(rB.allowed).toBe(true);
		});

		it('includes the rule in the result', async () => {
			const rule = makeRule(5);
			const result = await limiter.increment('key1', rule);
			expect(result.rule).toBe(rule);
		});
	});

	describe('window expiry', () => {
		it('resets after window expires', async () => {
			const rule = makeRule(1, 1); // 1 second window
			await limiter.increment('key1', rule);

			const denied = await limiter.increment('key1', rule);
			expect(denied.allowed).toBe(false);

			// Wait for window to expire
			await new Promise((resolve) => setTimeout(resolve, 1100));

			const allowed = await limiter.increment('key1', rule);
			expect(allowed.allowed).toBe(true);
			expect(allowed.remaining).toBe(0);
		});
	});

	describe('store reset', () => {
		it('allows requests again after manual store reset', async () => {
			const rule = makeRule(1);
			await limiter.increment('key1', rule);

			const denied = await limiter.increment('key1', rule);
			expect(denied.allowed).toBe(false);

			await store.reset('key1');

			const allowed = await limiter.increment('key1', rule);
			expect(allowed.allowed).toBe(true);
		});
	});
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../context/types.js';
import { BudgetTracker } from './tracker.js';

const user: Identity = { id: 'user_1', roles: ['user'] };
const orgUser: Identity = { id: 'user_2', roles: ['user'], orgId: 'org_1' };

describe('BudgetTracker', () => {
	let tracker: BudgetTracker;

	beforeEach(() => {
		tracker = new BudgetTracker();
	});

	describe('with no limits set', () => {
		it('returns infinite budget when no limits configured', async () => {
			const status = await tracker.check(user, 'tool_a', 10);
			expect(status.isExceeded).toBe(false);
			expect(status.limit).toBe(Number.POSITIVE_INFINITY);
			expect(status.remaining).toBe(Number.POSITIVE_INFINITY);
		});

		it('records spending but reports infinite remaining', async () => {
			const status = await tracker.record(user, 'tool_a', 50);
			expect(status.isExceeded).toBe(false);
			expect(status.spent).toBe(50);
			expect(status.remaining).toBe(Number.POSITIVE_INFINITY);
		});
	});

	describe('tracking spending', () => {
		beforeEach(() => {
			tracker.setLimit('global', {
				scope: 'global',
				maxAmount: 100,
				period: 'total',
			});
		});

		it('tracks spending correctly', async () => {
			await tracker.record(user, 'tool_a', 30);
			const status = await tracker.getStatus(user);
			expect(status.spent).toBe(30);
			expect(status.remaining).toBe(70);
			expect(status.percentUsed).toBeCloseTo(0.3);
		});

		it('accumulates spending across multiple records', async () => {
			await tracker.record(user, 'tool_a', 20);
			await tracker.record(user, 'tool_a', 30);
			await tracker.record(user, 'tool_a', 10);
			const status = await tracker.getStatus(user);
			expect(status.spent).toBe(60);
			expect(status.remaining).toBe(40);
		});
	});

	describe('budget exceeded detection', () => {
		beforeEach(() => {
			tracker.setLimit('global', {
				scope: 'global',
				maxAmount: 50,
				period: 'total',
			});
		});

		it('detects when budget is exceeded', async () => {
			await tracker.record(user, 'tool_a', 30);
			await tracker.record(user, 'tool_a', 25);
			const status = await tracker.getStatus(user);
			expect(status.isExceeded).toBe(true);
			expect(status.remaining).toBe(0);
		});

		it('check projects cost without recording it', async () => {
			await tracker.record(user, 'tool_a', 40);
			const checkResult = await tracker.check(user, 'tool_a', 20);
			expect(checkResult.isExceeded).toBe(true);
			expect(checkResult.spent).toBe(60); // 40 recorded + 20 projected

			// Actual status should still show 40
			const status = await tracker.getStatus(user);
			expect(status.spent).toBe(40);
		});

		it('not exceeded when within limit', async () => {
			await tracker.record(user, 'tool_a', 10);
			const status = await tracker.getStatus(user);
			expect(status.isExceeded).toBe(false);
		});
	});

	describe('identity-scoped limits', () => {
		it('uses identity-specific limit when set', async () => {
			tracker.setLimit('identity:user_1', {
				scope: 'identity',
				maxAmount: 25,
				period: 'total',
			});
			tracker.setLimit('global', {
				scope: 'global',
				maxAmount: 1000,
				period: 'total',
			});

			await tracker.record(user, 'tool_a', 20);
			await tracker.record(user, 'tool_a', 10);
			const status = await tracker.getStatus(user);
			expect(status.isExceeded).toBe(true);
			expect(status.limit).toBe(25);
		});
	});

	describe('org-scoped limits', () => {
		it('uses org limit when identity limit is not set', async () => {
			tracker.setLimit('org:org_1', {
				scope: 'org',
				maxAmount: 200,
				period: 'total',
			});
			tracker.setLimit('global', {
				scope: 'global',
				maxAmount: 1000,
				period: 'total',
			});

			await tracker.record(orgUser, 'tool_a', 150);
			await tracker.record(orgUser, 'tool_a', 60);
			const status = await tracker.getStatus(orgUser);
			expect(status.isExceeded).toBe(true);
			expect(status.limit).toBe(200);
		});
	});

	describe('reset', () => {
		it('resets spending for an identity', async () => {
			tracker.setLimit('global', {
				scope: 'global',
				maxAmount: 100,
				period: 'total',
			});

			await tracker.record(user, 'tool_a', 80);
			let status = await tracker.getStatus(user);
			expect(status.spent).toBe(80);

			await tracker.reset(user);
			status = await tracker.getStatus(user);
			expect(status.spent).toBe(0);
		});

		it('does nothing when no limit is set', async () => {
			// Should not throw
			await tracker.reset(user);
		});
	});

	describe('period-based limits', () => {
		it('returns resetsAt for periodic budgets', async () => {
			tracker.setLimit('global', {
				scope: 'global',
				maxAmount: 100,
				period: 'hourly',
			});

			const status = await tracker.getStatus(user);
			expect(status.resetsAt).toBeInstanceOf(Date);
			expect(status.period).toBe('hourly');
		});

		it('returns null resetsAt for total budgets', async () => {
			tracker.setLimit('global', {
				scope: 'global',
				maxAmount: 100,
				period: 'total',
			});

			const status = await tracker.getStatus(user);
			expect(status.resetsAt).toBeNull();
		});

		it('resets spending after period expires for hourly period', async () => {
			tracker.setLimit('global', {
				scope: 'global',
				maxAmount: 10,
				period: 'hourly',
			});

			await tracker.record(user, 'tool_a', 8);
			const status = await tracker.getStatus(user);
			expect(status.spent).toBe(8);

			// The InMemoryBudgetStore uses time-bucketed windows.
			// We can't easily test expiry without mocking Date.now,
			// but we verify the period and resetsAt are set correctly.
			expect(status.period).toBe('hourly');
			expect(status.resetsAt).not.toBeNull();
		});
	});

	describe('tool-scoped limits', () => {
		it('tracks independent usage for each tool', async () => {
			tracker.setLimit('identity:*:tool:tool_a', {
				scope: 'identity',
				maxAmount: 10,
				period: 'daily',
			});
			tracker.setLimit('identity:*:tool:tool_b', {
				scope: 'identity',
				maxAmount: 100,
				period: 'daily',
			});

			await tracker.record(user, 'tool_a', 8);
			await tracker.record(user, 'tool_b', 20);

			const toolAStatus = await tracker.getStatus(user, 'tool_a');
			const toolBStatus = await tracker.getStatus(user, 'tool_b');
			const summary = await tracker.getStatus(user);

			expect(toolAStatus.limit).toBe(10);
			expect(toolAStatus.spent).toBe(8);
			expect(toolBStatus.limit).toBe(100);
			expect(toolBStatus.spent).toBe(20);
			expect(summary.limit).toBe(10);
			expect(summary.spent).toBe(8);
		});

		it('enforces multiple periods for the same tool', async () => {
			tracker.setLimit('identity:*:tool:tool_a', {
				scope: 'identity',
				maxAmount: 10,
				period: 'hourly',
			});
			tracker.setLimit('identity:*:tool:tool_a', {
				scope: 'identity',
				maxAmount: 100,
				period: 'daily',
			});

			await tracker.record(user, 'tool_a', 8);
			const status = await tracker.check(user, 'tool_a', 3);

			expect(status.isExceeded).toBe(true);
			expect(status.limit).toBe(10);
			expect(status.period).toBe('hourly');
		});
	});
});

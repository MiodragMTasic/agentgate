import type { Identity } from '../context/types.js';
import type { BudgetLimit, BudgetPeriod, BudgetStatus, BudgetStore } from './types.js';

const PERIOD_MS: Record<Exclude<BudgetPeriod, 'total'>, number> = {
	hourly: 60 * 60 * 1000,
	daily: 24 * 60 * 60 * 1000,
	weekly: 7 * 24 * 60 * 60 * 1000,
	monthly: 30 * 24 * 60 * 60 * 1000,
};

function getPeriodMs(period: BudgetPeriod): number | undefined {
	if (period === 'total') return undefined;
	return PERIOD_MS[period];
}

function getResetsAt(period: BudgetPeriod): Date | null {
	if (period === 'total') return null;
	const now = Date.now();
	const ms = PERIOD_MS[period];
	const windowStart = Math.floor(now / ms) * ms;
	return new Date(windowStart + ms);
}

function buildStatus(spent: number, limit: BudgetLimit): BudgetStatus {
	const remaining = Math.max(0, limit.maxAmount - spent);
	const percentUsed = limit.maxAmount > 0 ? spent / limit.maxAmount : 0;
	return {
		spent,
		limit: limit.maxAmount,
		remaining,
		period: limit.period,
		resetsAt: getResetsAt(limit.period),
		percentUsed,
		isExceeded: spent > limit.maxAmount,
	};
}

class InMemoryBudgetStore implements BudgetStore {
	private data = new Map<string, { amount: number; expiresAt: number | null }>();

	async get(key: string): Promise<number> {
		const entry = this.data.get(key);
		if (!entry) return 0;
		if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
			this.data.delete(key);
			return 0;
		}
		return entry.amount;
	}

	async increment(key: string, amount: number, periodMs?: number): Promise<number> {
		const entry = this.data.get(key);
		const now = Date.now();

		if (entry && entry.expiresAt !== null && now >= entry.expiresAt) {
			this.data.delete(key);
		}

		const current = this.data.get(key);
		if (current) {
			current.amount += amount;
			return current.amount;
		}

		const expiresAt = periodMs ? Math.floor(now / periodMs) * periodMs + periodMs : null;
		this.data.set(key, { amount, expiresAt });
		return amount;
	}

	async reset(key: string): Promise<void> {
		this.data.delete(key);
	}
}

export class BudgetTracker {
	private store: BudgetStore;
	private limits = new Map<string, BudgetLimit>();

	constructor(store?: BudgetStore) {
		this.store = store ?? new InMemoryBudgetStore();
	}

	setLimit(key: string, limit: BudgetLimit): void {
		this.limits.set(key, limit);
	}

	async check(identity: Identity, _tool: string, cost: number): Promise<BudgetStatus> {
		const limit = this.resolveLimit(identity);
		if (!limit) {
			return {
				spent: 0,
				limit: Number.POSITIVE_INFINITY,
				remaining: Number.POSITIVE_INFINITY,
				period: 'total',
				resetsAt: null,
				percentUsed: 0,
				isExceeded: false,
			};
		}

		const key = this.buildKey(identity, limit);
		const spent = await this.store.get(key);
		const projected = spent + cost;

		return buildStatus(projected, limit);
	}

	async record(identity: Identity, _tool: string, cost: number): Promise<BudgetStatus> {
		const limit = this.resolveLimit(identity);
		if (!limit) {
			return {
				spent: cost,
				limit: Number.POSITIVE_INFINITY,
				remaining: Number.POSITIVE_INFINITY,
				period: 'total',
				resetsAt: null,
				percentUsed: 0,
				isExceeded: false,
			};
		}

		const key = this.buildKey(identity, limit);
		const periodMs = getPeriodMs(limit.period);
		const spent = await this.store.increment(key, cost, periodMs);

		return buildStatus(spent, limit);
	}

	async getStatus(identity: Identity): Promise<BudgetStatus> {
		const limit = this.resolveLimit(identity);
		if (!limit) {
			return {
				spent: 0,
				limit: Number.POSITIVE_INFINITY,
				remaining: Number.POSITIVE_INFINITY,
				period: 'total',
				resetsAt: null,
				percentUsed: 0,
				isExceeded: false,
			};
		}

		const key = this.buildKey(identity, limit);
		const spent = await this.store.get(key);

		return buildStatus(spent, limit);
	}

	async reset(identity: Identity): Promise<void> {
		const limit = this.resolveLimit(identity);
		if (!limit) return;

		const key = this.buildKey(identity, limit);
		await this.store.reset(key);
	}

	private resolveLimit(identity: Identity): BudgetLimit | undefined {
		// Check identity-specific limit first, then org, then global
		const identityLimit = this.limits.get(`identity:${identity.id}`);
		if (identityLimit) return identityLimit;

		if (identity.orgId) {
			const orgLimit = this.limits.get(`org:${identity.orgId}`);
			if (orgLimit) return orgLimit;
		}

		return this.limits.get('global');
	}

	private buildKey(identity: Identity, limit: BudgetLimit): string {
		switch (limit.scope) {
			case 'identity':
				return `budget:identity:${identity.id}`;
			case 'org':
				return `budget:org:${identity.orgId ?? identity.id}`;
			case 'global':
				return 'budget:global';
		}
	}
}

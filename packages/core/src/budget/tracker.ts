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

function buildInfiniteStatus(spent = 0): BudgetStatus {
	return {
		spent,
		limit: Number.POSITIVE_INFINITY,
		remaining: Number.POSITIVE_INFINITY,
		period: 'total',
		resetsAt: null,
		percentUsed: 0,
		isExceeded: false,
	};
}

interface ParsedLimitKey {
	scope: 'identity' | 'org' | 'global';
	subject?: string;
	tool?: string;
}

interface BudgetLimitEntry {
	key: string;
	parsed: ParsedLimitKey;
	limit: BudgetLimit;
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
	private limits = new Map<string, BudgetLimit[]>();

	constructor(store?: BudgetStore) {
		this.store = store ?? new InMemoryBudgetStore();
	}

	setLimit(key: string, limit: BudgetLimit): void {
		const entries = this.limits.get(key) ?? [];
		const index = entries.findIndex((entry) => entry.period === limit.period);
		if (index >= 0) {
			entries[index] = limit;
		} else {
			entries.push(limit);
		}
		this.limits.set(key, entries);
	}

	async check(identity: Identity, _tool: string, cost: number): Promise<BudgetStatus> {
		const entries = this.getApplicableLimitEntries(identity, _tool);
		if (entries.length === 0) {
			return buildInfiniteStatus();
		}

		const statuses: BudgetStatus[] = [];
		for (const entry of entries) {
			const spent = await this.store.get(this.buildUsageKey(identity, entry));
			statuses.push(buildStatus(spent + cost, entry.limit));
		}

		return this.pickMostConstrainedStatus(statuses);
	}

	async record(identity: Identity, _tool: string, cost: number): Promise<BudgetStatus> {
		const entries = this.getApplicableLimitEntries(identity, _tool);
		if (entries.length === 0) {
			return buildInfiniteStatus(cost);
		}

		const statuses: BudgetStatus[] = [];
		for (const entry of entries) {
			const periodMs = getPeriodMs(entry.limit.period);
			const spent = await this.store.increment(this.buildUsageKey(identity, entry), cost, periodMs);
			statuses.push(buildStatus(spent, entry.limit));
		}

		return this.pickMostConstrainedStatus(statuses);
	}

	async getStatus(identity: Identity, tool?: string): Promise<BudgetStatus> {
		const entries = this.getApplicableLimitEntries(identity, tool);
		if (entries.length === 0) {
			return buildInfiniteStatus();
		}

		const statuses: BudgetStatus[] = [];
		for (const entry of entries) {
			const spent = await this.store.get(this.buildUsageKey(identity, entry));
			statuses.push(buildStatus(spent, entry.limit));
		}

		return this.pickMostConstrainedStatus(statuses);
	}

	async reset(identity: Identity, tool?: string): Promise<void> {
		const entries = this.getApplicableLimitEntries(identity, tool);
		if (entries.length === 0) return;

		const keys = new Set(entries.map((entry) => this.buildUsageKey(identity, entry)));
		for (const key of keys) {
			await this.store.reset(key);
		}
	}

	private getApplicableLimitEntries(identity: Identity, tool?: string): BudgetLimitEntry[] {
		const entries: BudgetLimitEntry[] = [];

		for (const [key, limits] of this.limits) {
			const parsed = this.parseLimitKey(key);
			if (!parsed || !this.matchesIdentity(parsed, identity)) {
				continue;
			}

			if (tool !== undefined && parsed.tool !== undefined && parsed.tool !== tool) {
				continue;
			}

			for (const limit of limits) {
				entries.push({ key, parsed, limit });
			}
		}

		return entries;
	}

	private buildUsageKey(identity: Identity, entry: BudgetLimitEntry): string {
		const scope = entry.limit.scope;
		let base: string;
		switch (scope) {
			case 'identity':
				base = `budget:identity:${identity.id}`;
				break;
			case 'org':
				base = `budget:org:${identity.orgId ?? identity.id}`;
				break;
			case 'global':
				base = 'budget:global';
				break;
		}

		if (entry.parsed.tool) {
			base += `:tool:${entry.parsed.tool}`;
		}

		return `${base}:period:${entry.limit.period}`;
	}

	private matchesIdentity(parsed: ParsedLimitKey, identity: Identity): boolean {
		switch (parsed.scope) {
			case 'identity':
				return parsed.subject === '*' || parsed.subject === identity.id;
			case 'org':
				return (
					identity.orgId !== undefined &&
					(parsed.subject === '*' || parsed.subject === identity.orgId)
				);
			case 'global':
				return true;
		}
	}

	private parseLimitKey(key: string): ParsedLimitKey | null {
		if (key === 'global') {
			return { scope: 'global' };
		}

		const parts = key.split(':');
		if (parts[0] === 'global' && parts[1] === 'tool' && parts.length >= 3) {
			return {
				scope: 'global',
				tool: parts.slice(2).join(':'),
			};
		}

		if ((parts[0] === 'identity' || parts[0] === 'org') && parts[1] !== undefined) {
			if (parts[2] === 'tool' && parts.length >= 4) {
				return {
					scope: parts[0],
					subject: parts[1],
					tool: parts.slice(3).join(':'),
				};
			}

			if (parts.length === 2) {
				return {
					scope: parts[0],
					subject: parts[1],
				};
			}
		}

		return null;
	}

	private pickMostConstrainedStatus(statuses: BudgetStatus[]): BudgetStatus {
		return (
			statuses.reduce(
				(mostConstrained, status) => {
					if (mostConstrained === null) {
						return status;
					}

					if (status.isExceeded !== mostConstrained.isExceeded) {
						return status.isExceeded ? status : mostConstrained;
					}

					if (status.percentUsed !== mostConstrained.percentUsed) {
						return status.percentUsed > mostConstrained.percentUsed ? status : mostConstrained;
					}

					if (status.remaining !== mostConstrained.remaining) {
						return status.remaining < mostConstrained.remaining ? status : mostConstrained;
					}

					return status.limit < mostConstrained.limit ? status : mostConstrained;
				},
				null as BudgetStatus | null,
			) ?? buildInfiniteStatus()
		);
	}
}

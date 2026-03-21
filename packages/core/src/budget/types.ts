export type BudgetScope = 'identity' | 'org' | 'global';
export type BudgetPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'total';

export interface BudgetLimit {
	scope: BudgetScope;
	maxAmount: number;
	period: BudgetPeriod;
	unit?: string;
	warningThreshold?: number;
}

export interface BudgetStatus {
	spent: number;
	limit: number;
	remaining: number;
	period: BudgetPeriod;
	resetsAt: Date | null;
	percentUsed: number;
	isExceeded: boolean;
}

export interface BudgetStore {
	get(key: string): Promise<number>;
	increment(key: string, amount: number, periodMs?: number): Promise<number>;
	reset(key: string): Promise<void>;
}

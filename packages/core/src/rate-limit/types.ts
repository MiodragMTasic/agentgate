export type RateLimitScope = 'identity' | 'tool' | 'identity:tool' | 'global';
export type RateLimitStrategy = 'sliding-window' | 'token-bucket';

export interface RateLimitRule {
	name: string;
	tools: string | string[];
	maxRequests: number;
	windowSeconds: number;
	scope: RateLimitScope;
	strategy: RateLimitStrategy;
}

export interface RateLimitStoreEntry {
	count: number;
	resetsAt: Date;
}

export interface RateLimitStore {
	increment(key: string, windowMs: number): Promise<RateLimitStoreEntry>;
	peek(key: string): Promise<RateLimitStoreEntry>;
	reset(key: string): Promise<void>;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetsAt: Date;
	rule: RateLimitRule;
}

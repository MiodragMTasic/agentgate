import type { Identity } from '../context/types.js';
import type { ParamConstraint } from '../policy/types.js';

export type { ParamConstraint } from '../policy/types.js';

export interface ToolCapability {
	tool: string;
	allowed: boolean;
	conditions?: string[];
	rateLimit?: {
		remaining: number;
		resetsAt: Date;
	};
	budgetRemaining?: number;
	requiresApproval: boolean;
	paramConstraints?: Record<string, ParamConstraint>;
}

export interface DiscoveryBudgetStatus {
	limit: number;
	used: number;
	remaining: number;
	period: string;
	scope: 'user' | 'org' | 'global';
}

export interface CapabilityMap {
	identity: Identity;
	evaluatedAt: Date;
	tools: ToolCapability[];
	budget?: DiscoveryBudgetStatus;
}

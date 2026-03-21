export interface PolicySet {
	version: string;
	defaults?: PolicyDefaults;
	roles?: Record<string, RoleDefinition>;
	tools: Record<string, ToolPolicy>;
	conditions?: Record<string, PolicyCondition>;
}

export interface PolicyDefaults {
	verdict: 'allow' | 'deny';
	audit?: boolean;
	rateLimit?: RateLimitConfig;
}

export interface RoleDefinition {
	description?: string;
	inherits?: string[];
}

export interface ToolPolicy {
	allow?: AccessRule | AccessRule[];
	deny?: AccessRule | AccessRule[];
	rateLimit?: RateLimitConfig;
	cost?: number | CostConfig;
	budget?: BudgetConfig;
	requireApproval?: ApprovalConfig;
	audit?: boolean;
}

export interface AccessRule {
	roles?: string[];
	params?: Record<string, ParamConstraint>;
	conditions?: Record<string, PolicyCondition>;
}

export interface ParamConstraint {
	pattern?: string;
	contains?: string[];
	notContains?: string[];
	enum?: unknown[];
	min?: number;
	max?: number;
	maxLength?: number;
	maxItems?: number;
	startsWith?: string;
	notStartsWith?: string[];
	forbidden?: boolean;
}

export interface RateLimitConfig {
	maxRequests: number;
	window: string;
	scope?: 'identity' | 'tool' | 'identity:tool' | 'global';
	strategy?: 'sliding-window' | 'token-bucket';
}

export interface CostConfig {
	base: number;
	perParam?: Record<string, { perUnit: number; unit?: string }>;
}

export interface BudgetConfig {
	perUser?: BudgetPeriods;
	perOrg?: BudgetPeriods;
	global?: BudgetPeriods;
}

export interface BudgetPeriods {
	hourly?: number;
	daily?: number;
	weekly?: number;
	monthly?: number;
	total?: number;
}

export interface ApprovalConfig {
	when?: AccessRule;
	approvers?: string[];
	timeout?: string;
	timeoutAction?: 'deny' | 'allow';
	message?: string;
}

export interface PolicyCondition {
	time?: TimeCondition;
	expression?: string;
}

export interface TimeCondition {
	days?: string[];
	hours?: { after: string; before: string };
	timezone?: string;
}

export interface EvaluatedRule {
	verdict: 'allow' | 'deny' | 'pending_approval';
	reason: string;
	ruleName: string;
}

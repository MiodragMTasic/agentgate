// Core types
export type { GateDecision, GateRequest, GateVerdict, Identity } from './context/types.js';

// Policy engine
export {
	PolicyEngine,
	parsePolicyFromFile,
	parsePolicyFromObject,
	parsePolicyFromYaml,
	validatePolicy,
	mergePolicies,
} from './policy/index.js';
export type {
	AccessRule,
	ApprovalConfig,
	BudgetConfig,
	BudgetPeriods,
	CostConfig,
	ParamConstraint,
	PolicyCondition,
	PolicyDefaults,
	PolicySet,
	RateLimitConfig,
	RoleDefinition,
	TimeCondition,
	ToolPolicy,
} from './policy/index.js';

// Guards
export { createToolGuard, createParamGuard, ParamGuard } from './guard/index.js';
export type { ToolGuardOptions, GuardedTool, ParamGuardRule } from './guard/index.js';

// Errors
export {
	AgentGateError,
	PolicyParseError,
	PolicyValidationError,
	GateDeniedError,
	ApprovalTimeoutError,
	BudgetExceededError,
	RateLimitError,
} from './errors.js';

// Re-export submodules (these will be populated by agents)
export * from './rate-limit/index.js';
export * from './audit/index.js';
export * from './budget/index.js';
export * from './discovery/index.js';
export * from './hitl/index.js';

// Main class
export { AgentGate } from './gate.js';
export type { AgentGateConfig } from './gate.js';

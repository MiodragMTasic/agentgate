import type { GateDecision } from './context/types.js';

export class AgentGateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AgentGateError';
	}
}

export class PolicyParseError extends AgentGateError {
	constructor(message: string) {
		super(message);
		this.name = 'PolicyParseError';
	}
}

export class PolicyValidationError extends AgentGateError {
	public readonly errors: string[];
	constructor(errors: string[]) {
		super(`Policy validation failed: ${errors.join('; ')}`);
		this.name = 'PolicyValidationError';
		this.errors = errors;
	}
}

export class GateDeniedError extends AgentGateError {
	public readonly decision: GateDecision;
	constructor(decision: GateDecision) {
		super(`[AgentGate DENIED] ${decision.reason}`);
		this.name = 'GateDeniedError';
		this.decision = decision;
	}
}

export class ApprovalTimeoutError extends AgentGateError {
	public readonly approvalId: string;
	constructor(approvalId: string) {
		super(`Approval ${approvalId} timed out`);
		this.name = 'ApprovalTimeoutError';
		this.approvalId = approvalId;
	}
}

export class BudgetExceededError extends AgentGateError {
	public readonly tool: string;
	public readonly spent: number;
	public readonly limit: number;
	constructor(tool: string, spent: number, limit: number) {
		super(`Budget exceeded for tool "${tool}": spent ${spent} of ${limit}`);
		this.name = 'BudgetExceededError';
		this.tool = tool;
		this.spent = spent;
		this.limit = limit;
	}
}

export class RateLimitError extends AgentGateError {
	public readonly tool: string;
	public readonly resetsAt: Date;
	constructor(tool: string, resetsAt: Date) {
		super(`Rate limit exceeded for tool "${tool}". Resets at ${resetsAt.toISOString()}`);
		this.name = 'RateLimitError';
		this.tool = tool;
		this.resetsAt = resetsAt;
	}
}

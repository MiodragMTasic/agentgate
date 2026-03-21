import type { GateDecision, Identity } from '../context/types.js';

export interface ToolGuardOptions<TInput = unknown, TOutput = unknown> {
	name: string;
	identity: Identity | ((input: TInput) => Identity | Promise<Identity>);
	execute: (input: TInput) => TOutput | Promise<TOutput>;
	transformParams?: (input: TInput) => Record<string, unknown>;
	onDenied?: (decision: GateDecision, input: TInput) => TOutput | Promise<TOutput>;
	onPendingApproval?: (decision: GateDecision, input: TInput) => TOutput | Promise<TOutput>;
}

export interface GuardedTool<TInput = unknown, TOutput = unknown> {
	name: string;
	execute: (input: TInput) => Promise<TOutput>;
}

export interface ParamGuardRule {
	param: string;
	check: (value: unknown) => boolean;
	message: string;
}

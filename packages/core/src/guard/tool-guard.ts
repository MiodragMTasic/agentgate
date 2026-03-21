import type { GateDecision, GateRequest } from '../context/types.js';
import type { PolicyEngine } from '../policy/engine.js';
import type { ToolGuardOptions } from './types.js';

export interface ToolGuardConfig<TInput, TOutput> extends ToolGuardOptions<TInput, TOutput> {
	engine: PolicyEngine;
	onDecision?: (decision: GateDecision) => void;
	waitForApproval?: (approvalId: string) => Promise<boolean>;
}

export function createToolGuard<TInput, TOutput>(
	config: ToolGuardConfig<TInput, TOutput>,
): (input: TInput) => Promise<TOutput> {
	return async (input: TInput): Promise<TOutput> => {
		const identity =
			typeof config.identity === 'function' ? await config.identity(input) : config.identity;

		const params = config.transformParams
			? config.transformParams(input)
			: (input as Record<string, unknown>);

		const request: GateRequest = {
			tool: config.name,
			params:
				typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {},
			identity,
		};

		const decision = config.engine.evaluate(request);

		config.onDecision?.(decision);

		if (decision.verdict === 'deny') {
			if (config.onDenied) {
				return config.onDenied(decision, input);
			}
			throw new Error(`[AgentGate DENIED] Tool "${config.name}": ${decision.reason}`);
		}

		if (decision.verdict === 'pending_approval') {
			if (config.waitForApproval && decision.approvalId) {
				const approved = await config.waitForApproval(decision.approvalId);
				if (!approved) {
					if (config.onDenied) {
						return config.onDenied(decision, input);
					}
					throw new Error(`[AgentGate DENIED] Approval denied for tool "${config.name}"`);
				}
			} else if (config.onPendingApproval) {
				return config.onPendingApproval(decision, input);
			} else {
				throw new Error(
					`[AgentGate] Tool "${config.name}" requires approval but no approval handler configured`,
				);
			}
		}

		return config.execute(input);
	};
}

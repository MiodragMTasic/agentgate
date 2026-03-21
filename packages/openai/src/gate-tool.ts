import type { AgentGate } from '@miodragmtasic/agentgate-core';
import { GateDeniedError } from '@miodragmtasic/agentgate-core';
import type { GateOpenAIToolOptions, GatedOpenAITool } from './types.js';

/**
 * Creates a gated OpenAI tool with both the function definition
 * and a guarded executor.
 *
 * @example
 * ```ts
 * const weatherTool = gateTool(gate, {
 *   definition: {
 *     type: 'function',
 *     function: {
 *       name: 'get_weather',
 *       description: 'Get weather for a location',
 *       parameters: { type: 'object', properties: { location: { type: 'string' } } },
 *     },
 *   },
 *   execute: async (args) => ({ temp: 72, condition: 'sunny' }),
 *   identity: { id: 'user_42', roles: ['user'] },
 * });
 * ```
 */
export function gateTool(gate: AgentGate, options: GateOpenAIToolOptions): GatedOpenAITool {
	return {
		definition: options.definition,
		execute: async (args: Record<string, unknown>) => {
			const identity =
				typeof options.identity === 'function' ? await options.identity(args) : options.identity;

			const decision = await gate.evaluate({
				tool: options.definition.function.name,
				params: args,
				identity,
			});

			if (decision.verdict === 'deny') {
				throw new GateDeniedError(decision);
			}

			if (decision.verdict === 'pending_approval') {
				const approvalId = decision.approvalId;
				if (!approvalId) {
					throw new GateDeniedError({
						...decision,
						verdict: 'deny',
						reason: `Approval request missing an approvalId for tool "${options.definition.function.name}".`,
					});
				}

				const approved = await gate.waitForApproval(approvalId);
				if (!approved) {
					throw new GateDeniedError({
						...decision,
						verdict: 'deny',
						reason: `Approval denied for tool "${options.definition.function.name}".`,
					});
				}
			}

			return options.execute(args);
		},
	};
}

import type { AgentGate } from '@agentgate/core';
import { GateDeniedError } from '@agentgate/core';
import type { GatedOpenAITool, GateOpenAIToolOptions } from './types.js';

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
export function gateTool(
	gate: AgentGate,
	options: GateOpenAIToolOptions,
): GatedOpenAITool {
	return {
		definition: options.definition,
		execute: async (args: Record<string, unknown>) => {
			const identity =
				typeof options.identity === 'function'
					? await options.identity(args)
					: options.identity;

			const decision = await gate.evaluate({
				tool: options.definition.function.name,
				params: args,
				identity,
			});

			if (decision.verdict === 'deny') {
				throw new GateDeniedError(decision);
			}

			if (decision.verdict === 'pending_approval') {
				const approved = await gate.waitForApproval(decision.approvalId!);
				if (!approved) {
					throw new GateDeniedError(decision);
				}
			}

			return options.execute(args);
		},
	};
}

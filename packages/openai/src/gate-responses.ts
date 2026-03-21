import type { AgentGate, Identity } from '@agentgate/core';

interface ToolExecutor {
	[toolName: string]: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/**
 * Creates a gated tool executor map for use with the OpenAI Responses API.
 *
 * Wraps each tool function with AgentGate policy checks before
 * allowing execution.
 *
 * @example
 * ```ts
 * const tools = {
 *   get_weather: async (args) => ({ temp: 72 }),
 *   send_email: async (args) => ({ sent: true }),
 * };
 *
 * const gatedTools = gateToolExecutors(gate, tools, identity);
 * // Use gatedTools in your tool execution loop
 * ```
 */
export function gateToolExecutors(
	gate: AgentGate,
	tools: ToolExecutor,
	identity: Identity,
): ToolExecutor {
	const gated: ToolExecutor = {};

	for (const [name, fn] of Object.entries(tools)) {
		gated[name] = async (args: Record<string, unknown>) => {
			const decision = await gate.evaluate({
				tool: name,
				params: args,
				identity,
			});

			if (decision.verdict === 'deny') {
				return { error: 'Permission denied', reason: decision.reason };
			}

			if (decision.verdict === 'pending_approval') {
				const approved = await gate.waitForApproval(decision.approvalId!);
				if (!approved) {
					return {
						error: 'Permission denied',
						reason: `Approval denied for tool "${name}"`,
					};
				}
			}

			return fn(args);
		};
	}

	return gated;
}

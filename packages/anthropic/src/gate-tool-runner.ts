import type { AgentGate, Identity } from '@agentgate/core';

interface RunnableTool {
	name: string;
	run: (input: unknown) => unknown;
	[key: string]: unknown;
}

interface ToolRunnerParams {
	tools: RunnableTool[];
	[key: string]: unknown;
}

/**
 * Creates a gated tool runner factory that wraps the Anthropic toolRunner.
 *
 * Intercepts all tool.run() calls with AgentGate policy checks
 * before allowing execution.
 *
 * @example
 * ```ts
 * const gateRunner = createGateToolRunner(gate, { id: 'user_42', roles: ['user'] });
 *
 * // Use with Anthropic SDK:
 * const response = await client.beta.messages.toolRunner({
 *   model: 'claude-sonnet-4-5-20250929',
 *   tools: gateRunner.wrapTools([tool1, tool2]),
 *   messages: [...],
 * });
 * ```
 */
export function createGateToolRunner(gate: AgentGate, identity: Identity) {
	return {
		wrapTools<T extends RunnableTool>(tools: T[]): T[] {
			return tools.map((tool) => {
				if (!('run' in tool) || typeof tool.run !== 'function') {
					return tool; // Schema-only tools pass through
				}

				const originalRun = tool.run;

				return {
					...tool,
					run: async (input: unknown) => {
						const decision = await gate.evaluate({
							tool: tool.name,
							params: (input ?? {}) as Record<string, unknown>,
							identity,
						});

						if (decision.verdict === 'deny') {
							return `[AgentGate DENIED] Tool "${tool.name}" blocked: ${decision.reason}`;
						}

						if (decision.verdict === 'pending_approval') {
							const approved = await gate.waitForApproval(decision.approvalId!);
							if (!approved) {
								return `[AgentGate DENIED] Approval denied for tool "${tool.name}".`;
							}
						}

						return originalRun.call(tool, input);
					},
				} as T;
			});
		},

		wrapParams(params: ToolRunnerParams): ToolRunnerParams {
			return {
				...params,
				tools: this.wrapTools(params.tools),
			};
		},
	};
}

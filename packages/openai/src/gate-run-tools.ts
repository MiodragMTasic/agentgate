import type { AgentGate, Identity } from '@miodragmtasic/agentgate-core';

interface FunctionTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
		function?: (args: unknown) => unknown;
		parse?: (content: string) => unknown;
		[key: string]: unknown;
	};
}

interface RunToolsParams {
	tools: FunctionTool[];
	[key: string]: unknown;
}

/**
 * Wraps OpenAI's runTools() parameters to intercept function execution
 * with AgentGate policy checks.
 *
 * @example
 * ```ts
 * const gatedParams = gateRunToolsParams(gate, identity, {
 *   model: 'gpt-4.1',
 *   messages,
 *   tools: [{ type: 'function', function: { name: 'get_weather', ... } }],
 * });
 *
 * const runner = openai.chat.completions.runTools(gatedParams);
 * ```
 */
export function gateRunToolsParams(
	gate: AgentGate,
	identity: Identity,
	params: RunToolsParams,
): RunToolsParams {
	const gatedTools = params.tools.map((tool) => {
		if (tool.type !== 'function' || !tool.function?.function) {
			return tool;
		}

		const originalFn = tool.function.function;
		const toolName = tool.function.name;

		return {
			...tool,
			function: {
				...tool.function,
				function: async (args: unknown) => {
					const decision = await gate.evaluate({
						tool: toolName,
						params: (args ?? {}) as Record<string, unknown>,
						identity,
					});

					if (decision.verdict === 'deny') {
						return JSON.stringify({
							error: 'Permission denied',
							reason: decision.reason,
						});
					}

					if (decision.verdict === 'pending_approval') {
						const approvalId = decision.approvalId;
						if (!approvalId) {
							return JSON.stringify({
								error: 'Permission denied',
								reason: `Approval request missing an approvalId for tool "${toolName}".`,
							});
						}

						const approved = await gate.waitForApproval(approvalId);
						if (!approved) {
							return JSON.stringify({
								error: 'Permission denied',
								reason: `Approval denied for tool "${toolName}".`,
							});
						}
					}

					return originalFn(args);
				},
			},
		};
	});

	return {
		...params,
		tools: gatedTools,
	};
}

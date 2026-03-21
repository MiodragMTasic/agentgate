import type { AgentGate, Identity } from '@agentgate/core';
import type { GateToolOptions } from './types.js';

/**
 * Drop-in replacement for Anthropic's betaTool() that adds permission guards.
 *
 * @example
 * ```ts
 * // Before:
 * const tool = betaTool({ name: 'send_email', inputSchema: {...}, run: async (input) => '...' });
 *
 * // After:
 * const tool = gateTool(gate, { name: 'send_email', inputSchema: {...}, identity: user, run: async (input) => '...' });
 * ```
 */
export function gateTool<TInput extends Record<string, unknown> = Record<string, unknown>>(
	gate: AgentGate,
	options: GateToolOptions<TInput>,
) {
	return {
		name: options.name,
		description: options.description,
		input_schema: options.inputSchema,
		parse: (content: unknown): TInput => {
			if (typeof content === 'string') {
				return JSON.parse(content) as TInput;
			}
			return content as TInput;
		},
		run: async (input: TInput): Promise<string> => {
			const identity =
				typeof options.identity === 'function'
					? await options.identity(input)
					: options.identity;

			const decision = await gate.evaluate({
				tool: options.name,
				params: input as Record<string, unknown>,
				identity,
			});

			if (decision.verdict === 'deny') {
				return `[AgentGate DENIED] Tool "${options.name}" blocked: ${decision.reason}`;
			}

			if (decision.verdict === 'pending_approval') {
				const approved = await gate.waitForApproval(decision.approvalId!);
				if (!approved) {
					return `[AgentGate DENIED] Approval denied for tool "${options.name}".`;
				}
			}

			return options.run(input);
		},
	};
}

/**
 * Wraps an existing Anthropic BetaRunnableTool with AgentGate policy checks.
 */
export function wrapTool<TInput = unknown>(
	gate: AgentGate,
	tool: { name: string; run: (input: TInput) => unknown; parse?: (content: unknown) => TInput; [key: string]: unknown },
	identity: Identity | ((input: TInput) => Identity | Promise<Identity>),
) {
	const originalRun = tool.run;

	return {
		...tool,
		run: async (input: TInput): Promise<unknown> => {
			const resolvedIdentity =
				typeof identity === 'function' ? await identity(input) : identity;

			const decision = await gate.evaluate({
				tool: tool.name,
				params: (input ?? {}) as Record<string, unknown>,
				identity: resolvedIdentity,
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
	};
}

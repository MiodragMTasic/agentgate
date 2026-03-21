import type { AgentGate, Identity } from '@agentgate/core';
import type { MCPServerContext, ToolCallResult } from './types.js';

type NextFn = (
	args: Record<string, unknown>,
	ctx?: MCPServerContext,
) => Promise<ToolCallResult>;

type MiddlewareFn = (
	toolName: string,
	args: Record<string, unknown>,
	ctx: MCPServerContext | undefined,
	next: NextFn,
) => Promise<ToolCallResult>;

/**
 * Creates an AgentGate middleware function that can be applied
 * to any MCP tool handler pipeline.
 *
 * @example
 * ```ts
 * const middleware = createGateMiddleware(gate, (ctx) => ({
 *   id: ctx?.sessionId ?? 'anon',
 *   roles: ['user'],
 * }));
 *
 * // Use in a middleware pipeline:
 * const result = await middleware('tool_name', args, ctx, async (args, ctx) => {
 *   return originalHandler(args, ctx);
 * });
 * ```
 */
export function createGateMiddleware(
	gate: AgentGate,
	identityResolver: (ctx: MCPServerContext | undefined) => Identity | Promise<Identity>,
): MiddlewareFn {
	return async (toolName, args, ctx, next) => {
		const identity = await identityResolver(ctx);

		const decision = await gate.evaluate({
			tool: toolName,
			params: args,
			identity,
		});

		if (decision.verdict === 'deny') {
			return {
				content: [
					{
						type: 'text',
						text: `[AgentGate] Tool "${toolName}" denied: ${decision.reason}`,
					},
				],
				isError: true,
			};
		}

		if (decision.verdict === 'pending_approval') {
			const approved = await gate.waitForApproval(decision.approvalId!);
			if (!approved) {
				return {
					content: [
						{
							type: 'text',
							text: `[AgentGate] Approval denied for tool "${toolName}".`,
						},
					],
					isError: true,
				};
			}
		}

		return next(args, ctx);
	};
}

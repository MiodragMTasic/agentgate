import type { AgentGate } from '@agentgate/core';
import type {
	GateMcpServerConfig,
	GateMcpToolConfig,
	IdentityResolver,
	MCPServerContext,
	ToolCallResult,
} from './types.js';

type ToolHandler = (
	args: Record<string, unknown>,
	ctx?: MCPServerContext,
) => Promise<ToolCallResult>;

/**
 * GateMcpServer wraps MCP tool registration with AgentGate policy checks.
 *
 * @example
 * ```ts
 * const server = new GateMcpServer(
 *   { name: 'my-server', version: '1.0.0' },
 *   gate,
 *   (ctx) => ({ id: ctx.sessionId ?? 'anonymous', roles: ['user'] }),
 * );
 *
 * server.registerTool('get_weather', {
 *   title: 'Get Weather',
 *   description: 'Get weather for a location',
 *   inputSchema: { type: 'object', properties: { location: { type: 'string' } } },
 * }, async (args) => ({
 *   content: [{ type: 'text', text: `Weather in ${args.location}: sunny` }],
 * }));
 * ```
 */
export class GateMcpServer {
	private gate: AgentGate;
	private identityResolver: IdentityResolver;
	private tools = new Map<string, { config: GateMcpToolConfig; handler: ToolHandler }>();
	public readonly config: GateMcpServerConfig;

	constructor(
		config: GateMcpServerConfig,
		gate: AgentGate,
		identityResolver: IdentityResolver,
	) {
		this.config = config;
		this.gate = gate;
		this.identityResolver = identityResolver;
	}

	registerTool(
		id: string,
		config: GateMcpToolConfig,
		handler: ToolHandler,
	): void {
		const gatedHandler: ToolHandler = async (args, ctx) => {
			const identity = await this.identityResolver(ctx ?? {});

			const decision = await this.gate.evaluate({
				tool: id,
				params: args,
				identity,
			});

			if (decision.verdict === 'deny') {
				return {
					content: [
						{
							type: 'text',
							text: `[AgentGate] Tool "${id}" denied: ${decision.reason}`,
						},
					],
					isError: true,
				};
			}

			if (decision.verdict === 'pending_approval') {
				const approved = await this.gate.waitForApproval(decision.approvalId!);
				if (!approved) {
					return {
						content: [
							{
								type: 'text',
								text: `[AgentGate] Approval denied for tool "${id}".`,
							},
						],
						isError: true,
					};
				}
			}

			return handler(args, ctx);
		};

		this.tools.set(id, { config, handler: gatedHandler });
	}

	getTools(): Map<string, { config: GateMcpToolConfig; handler: ToolHandler }> {
		return this.tools;
	}

	async callTool(
		id: string,
		args: Record<string, unknown>,
		ctx?: MCPServerContext,
	): Promise<ToolCallResult> {
		const tool = this.tools.get(id);
		if (!tool) {
			return {
				content: [{ type: 'text', text: `Tool "${id}" not found` }],
				isError: true,
			};
		}
		return tool.handler(args, ctx);
	}
}

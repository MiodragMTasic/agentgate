import type { AgentGate, Identity } from '@miodragmtasic/agentgate-core';

interface MCPToolLike {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

interface MCPClientLike {
	callTool(params: {
		name: string;
		arguments?: Record<string, unknown>;
	}): Promise<unknown>;
}

/**
 * Wraps MCP tools with AgentGate policy checks when used
 * through the Anthropic SDK's mcpTool() helper.
 *
 * @example
 * ```ts
 * const mcpTools = await mcpClient.listTools();
 * const gatedTools = gateMcpTools(gate, mcpTools.tools, mcpClient, identity);
 *
 * const response = await client.beta.messages.toolRunner({
 *   tools: gatedTools,
 *   ...
 * });
 * ```
 */
export function gateMcpTools(
	gate: AgentGate,
	tools: MCPToolLike[],
	mcpClient: MCPClientLike,
	identity:
		| Identity
		| ((toolName: string, args: Record<string, unknown>) => Identity | Promise<Identity>),
) {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema,
		parse: (content: unknown) => {
			if (typeof content === 'string') return JSON.parse(content);
			return content;
		},
		run: async (args: Record<string, unknown>) => {
			const resolvedIdentity =
				typeof identity === 'function' ? await identity(tool.name, args) : identity;

			const decision = await gate.evaluate({
				tool: tool.name,
				params: args,
				identity: resolvedIdentity,
			});

			if (decision.verdict === 'deny') {
				return `[AgentGate DENIED] MCP tool "${tool.name}" blocked: ${decision.reason}`;
			}

			if (decision.verdict === 'pending_approval') {
				const approvalId = decision.approvalId;
				if (!approvalId) {
					return `[AgentGate DENIED] Approval request missing an approvalId for MCP tool "${tool.name}".`;
				}

				const approved = await gate.waitForApproval(approvalId);
				if (!approved) {
					return `[AgentGate DENIED] Approval denied for MCP tool "${tool.name}".`;
				}
			}

			const result = await mcpClient.callTool({
				name: tool.name,
				arguments: args,
			});

			return typeof result === 'string' ? result : JSON.stringify(result);
		},
	}));
}

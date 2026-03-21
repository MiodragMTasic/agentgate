import type { AgentGate, Identity } from '@agentgate/core';
import { GateDeniedError } from '@agentgate/core';

interface MCPClientLike {
	callTool(params: {
		name: string;
		arguments?: Record<string, unknown>;
	}): Promise<unknown>;
}

/**
 * Wraps an MCP Client's callTool method to add AgentGate policy checks
 * on the client side. Use this when you control the client but not the server.
 *
 * @example
 * ```ts
 * const gatedClient = gateClient(mcpClient, gate, identity);
 * const result = await gatedClient.callTool({ name: 'read_file', arguments: { path: '/etc/passwd' } });
 * // Throws GateDeniedError if policy denies it
 * ```
 */
export function gateClient<T extends MCPClientLike>(
	client: T,
	gate: AgentGate,
	identity: Identity,
): T {
	const originalCallTool = client.callTool.bind(client);

	const proxy = Object.create(client) as T;

	proxy.callTool = async (params: {
		name: string;
		arguments?: Record<string, unknown>;
	}): Promise<unknown> => {
		const decision = await gate.evaluate({
			tool: params.name,
			params: params.arguments ?? {},
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

		return originalCallTool(params);
	};

	return proxy;
}

import type { AgentGate } from '@miodragmtasic/agentgate-core';
import { GateDeniedError } from '@miodragmtasic/agentgate-core';
import { describe, expect, it, vi } from 'vitest';

import { gateClient } from './gate-client.js';

function createMockGate(verdict: 'allow' | 'deny' | 'pending_approval' = 'allow'): AgentGate {
	return {
		evaluate: vi.fn().mockResolvedValue({
			verdict,
			reason: verdict === 'deny' ? 'Denied by policy' : 'Allowed',
			decisionId: 'dec_test',
			timestamp: new Date(),
			evaluationTimeMs: 1,
			approvalId: verdict === 'pending_approval' ? 'apr_test' : undefined,
		}),
		waitForApproval: vi.fn().mockResolvedValue(false),
	} as unknown as AgentGate;
}

describe('gateClient', () => {
	it('passes through to the underlying MCP client when allowed', async () => {
		const gate = createMockGate('allow');
		const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
		const client = gateClient({ callTool }, gate, { id: 'user_1', roles: ['user'] });

		const result = await client.callTool({
			name: 'read_file',
			arguments: { path: '/tmp/demo.txt' },
		});

		expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
		expect(callTool).toHaveBeenCalledWith({
			name: 'read_file',
			arguments: { path: '/tmp/demo.txt' },
		});
	});

	it('throws when the policy denies the tool call', async () => {
		const gate = createMockGate('deny');
		const client = gateClient({ callTool: vi.fn() }, gate, { id: 'user_1', roles: ['user'] });

		await expect(
			client.callTool({
				name: 'delete_file',
				arguments: { path: '/tmp/demo.txt' },
			}),
		).rejects.toThrow(GateDeniedError);
	});

	it('waits for approval before calling the MCP client', async () => {
		const gate = createMockGate('pending_approval');
		(gate.waitForApproval as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'approved' }] });
		const client = gateClient({ callTool }, gate, { id: 'user_1', roles: ['user'] });

		const result = await client.callTool({
			name: 'deploy',
			arguments: { version: 'v1' },
		});

		expect(gate.waitForApproval).toHaveBeenCalledWith('apr_test');
		expect(result).toEqual({ content: [{ type: 'text', text: 'approved' }] });
		expect(callTool).toHaveBeenCalled();
	});
});

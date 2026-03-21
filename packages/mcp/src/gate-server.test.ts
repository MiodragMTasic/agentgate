import type { AgentGate } from '@miodragmtasic/agentgate-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GateMcpServer } from './gate-server.js';

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

describe('GateMcpServer', () => {
	let gate: AgentGate;
	let server: GateMcpServer;
	const identityResolver = vi.fn().mockResolvedValue({ id: 'session_1', roles: ['user'] });

	beforeEach(() => {
		gate = createMockGate('allow');
		identityResolver.mockClear();
		server = new GateMcpServer({ name: 'test-server', version: '1.0.0' }, gate, identityResolver);
	});

	describe('registerTool and callTool', () => {
		it('registers and calls tools through gate', async () => {
			const handler = vi.fn().mockResolvedValue({
				content: [{ type: 'text', text: 'Weather: sunny' }],
			});

			server.registerTool(
				'get_weather',
				{
					title: 'Get Weather',
					description: 'Get weather for a location',
					inputSchema: { type: 'object' },
				},
				handler,
			);

			const result = await server.callTool('get_weather', { location: 'NYC' });

			expect(result.content[0]?.text).toBe('Weather: sunny');
			expect(handler).toHaveBeenCalledWith({ location: 'NYC' }, undefined);
			expect(gate.evaluate).toHaveBeenCalledWith({
				tool: 'get_weather',
				params: { location: 'NYC' },
				identity: { id: 'session_1', roles: ['user'] },
			});
		});

		it('resolves identity via identityResolver', async () => {
			identityResolver.mockResolvedValue({ id: 'custom_user', roles: ['admin'] });

			server.registerTool('tool', { title: 'T', description: 'D', inputSchema: {} }, async () => ({
				content: [{ type: 'text', text: 'ok' }],
			}));

			const ctx = { sessionId: 'sess_123' };
			await server.callTool('tool', {}, ctx);

			expect(identityResolver).toHaveBeenCalledWith(ctx);
			expect(gate.evaluate).toHaveBeenCalledWith(
				expect.objectContaining({
					identity: { id: 'custom_user', roles: ['admin'] },
				}),
			);
		});
	});

	describe('denial handling', () => {
		it('returns error content when policy denies', async () => {
			gate = createMockGate('deny');
			server = new GateMcpServer({ name: 'test-server', version: '1.0.0' }, gate, identityResolver);

			const handler = vi.fn();
			server.registerTool(
				'delete_data',
				{ title: 'D', description: 'D', inputSchema: {} },
				handler,
			);

			const result = await server.callTool('delete_data', {});

			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain('[AgentGate]');
			expect(result.content[0]?.text).toContain('denied');
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('pending approval', () => {
		it('returns error when approval is denied', async () => {
			gate = createMockGate('pending_approval');
			server = new GateMcpServer({ name: 'test-server', version: '1.0.0' }, gate, identityResolver);

			const handler = vi.fn();
			server.registerTool(
				'deploy',
				{ title: 'Deploy', description: 'D', inputSchema: {} },
				handler,
			);

			const result = await server.callTool('deploy', {});
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain('Approval denied');
			expect(handler).not.toHaveBeenCalled();
		});

		it('proceeds when approval is granted', async () => {
			gate = createMockGate('pending_approval');
			(gate.waitForApproval as ReturnType<typeof vi.fn>).mockResolvedValue(true);
			server = new GateMcpServer({ name: 'test-server', version: '1.0.0' }, gate, identityResolver);

			const handler = vi.fn().mockResolvedValue({
				content: [{ type: 'text', text: 'Deployed!' }],
			});
			server.registerTool(
				'deploy',
				{ title: 'Deploy', description: 'D', inputSchema: {} },
				handler,
			);

			const result = await server.callTool('deploy', {});
			expect(result.content[0]?.text).toBe('Deployed!');
			expect(handler).toHaveBeenCalled();
		});
	});

	describe('unknown tool', () => {
		it('returns error for unregistered tool', async () => {
			const result = await server.callTool('nonexistent', {});
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain('not found');
		});
	});

	describe('getTools', () => {
		it('returns registered tools map', () => {
			server.registerTool('a', { title: 'A', description: 'A', inputSchema: {} }, async () => ({
				content: [{ type: 'text', text: '' }],
			}));
			server.registerTool('b', { title: 'B', description: 'B', inputSchema: {} }, async () => ({
				content: [{ type: 'text', text: '' }],
			}));

			const tools = server.getTools();
			expect(tools.size).toBe(2);
			expect(tools.has('a')).toBe(true);
			expect(tools.has('b')).toBe(true);
		});
	});

	describe('config', () => {
		it('exposes server config', () => {
			expect(server.config.name).toBe('test-server');
			expect(server.config.version).toBe('1.0.0');
		});
	});
});

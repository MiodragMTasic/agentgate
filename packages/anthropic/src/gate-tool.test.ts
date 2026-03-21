import type {
	BetaTool,
	MessageCreateParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { AgentGate } from '@miodragmtasic/agentgate-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gateTool, wrapTool } from './gate-tool.js';

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

describe('gateTool', () => {
	it('wraps tool and allows execution when policy permits', async () => {
		const gate = createMockGate('allow');
		const tool = gateTool(gate, {
			name: 'send_email',
			inputSchema: { type: 'object' },
			identity: { id: 'user_1', roles: ['user'] },
			run: vi.fn().mockReturnValue('Email sent'),
		});

		expect(tool.name).toBe('send_email');
		const result = await tool.run({ to: 'test@example.com' });
		expect(result).toBe('Email sent');
		expect(gate.evaluate).toHaveBeenCalledWith({
			tool: 'send_email',
			params: { to: 'test@example.com' },
			identity: { id: 'user_1', roles: ['user'] },
		});
	});

	it('returns denial message when policy denies', async () => {
		const gate = createMockGate('deny');
		const runFn = vi.fn();
		const tool = gateTool(gate, {
			name: 'send_email',
			inputSchema: { type: 'object' },
			identity: { id: 'user_1', roles: ['user'] },
			run: runFn,
		});

		const result = await tool.run({ to: 'test@example.com' });
		expect(result).toContain('[AgentGate DENIED]');
		expect(result).toContain('send_email');
		expect(runFn).not.toHaveBeenCalled();
	});

	it('resolves identity from function', async () => {
		const gate = createMockGate('allow');
		const identityFn = vi.fn().mockReturnValue({ id: 'dynamic_user', roles: ['admin'] });
		const tool = gateTool(gate, {
			name: 'test_tool',
			inputSchema: {},
			identity: identityFn,
			run: vi.fn().mockReturnValue('ok'),
		});

		await tool.run({ key: 'value' });
		expect(identityFn).toHaveBeenCalledWith({ key: 'value' });
		expect(gate.evaluate).toHaveBeenCalledWith(
			expect.objectContaining({
				identity: { id: 'dynamic_user', roles: ['admin'] },
			}),
		);
	});

	it('handles pending_approval verdict when approval is denied', async () => {
		const gate = createMockGate('pending_approval');
		const runFn = vi.fn();
		const tool = gateTool(gate, {
			name: 'deploy',
			inputSchema: {},
			identity: { id: 'user_1', roles: ['user'] },
			run: runFn,
		});

		const result = await tool.run({});
		expect(result).toContain('[AgentGate DENIED]');
		expect(result).toContain('Approval denied');
		expect(runFn).not.toHaveBeenCalled();
	});

	it('proceeds when pending_approval is approved', async () => {
		const gate = createMockGate('pending_approval');
		(gate.waitForApproval as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		const tool = gateTool(gate, {
			name: 'deploy',
			inputSchema: {},
			identity: { id: 'user_1', roles: ['user'] },
			run: vi.fn().mockReturnValue('deployed'),
		});

		const result = await tool.run({});
		expect(result).toBe('deployed');
	});

	it('exposes input_schema from inputSchema', () => {
		const gate = createMockGate();
		const schema = { type: 'object', properties: { x: { type: 'string' } } };
		const tool = gateTool(gate, {
			name: 'test',
			inputSchema: schema,
			identity: { id: 'u', roles: [] },
			run: () => '',
		});
		expect(tool.input_schema).toBe(schema);
	});

	it('parse handles string input', () => {
		const gate = createMockGate();
		const tool = gateTool(gate, {
			name: 'test',
			inputSchema: {},
			identity: { id: 'u', roles: [] },
			run: () => '',
		});
		const parsed = tool.parse('{"key":"val"}');
		expect(parsed).toEqual({ key: 'val' });
	});

	it('parse passes through object input', () => {
		const gate = createMockGate();
		const tool = gateTool(gate, {
			name: 'test',
			inputSchema: {},
			identity: { id: 'u', roles: [] },
			run: () => '',
		});
		const obj = { key: 'val' };
		expect(tool.parse(obj)).toBe(obj);
	});

	it('produces Anthropic-compatible tool shapes for message requests', () => {
		const gate = createMockGate('allow');
		const tool = gateTool(gate, {
			name: 'send_email',
			description: 'Send an email',
			inputSchema: {
				type: 'object',
				properties: {
					to: { type: 'string' },
				},
			},
			identity: { id: 'user_1', roles: ['user'] },
			run: vi.fn().mockResolvedValue('sent'),
		});

		const typedTool: BetaTool = tool;
		const request: MessageCreateParams = {
			model: 'claude-3-5-sonnet-latest',
			max_tokens: 64,
			messages: [{ role: 'user', content: 'send an email' }],
			tools: [tool],
		};

		expect(typedTool.name).toBe('send_email');
		expect(request.tools).toHaveLength(1);
	});
});

describe('wrapTool', () => {
	it('wraps an existing tool and preserves its properties', async () => {
		const gate = createMockGate('allow');
		const originalTool = {
			name: 'original_tool',
			description: 'A tool',
			run: vi.fn().mockReturnValue('original result'),
		};

		const wrapped = wrapTool(gate, originalTool, { id: 'u1', roles: ['user'] });
		expect(wrapped.name).toBe('original_tool');
		expect(wrapped.description).toBe('A tool');

		const result = await wrapped.run({ arg: 1 });
		expect(result).toBe('original result');
	});

	it('blocks execution when policy denies', async () => {
		const gate = createMockGate('deny');
		const originalTool = {
			name: 'blocked_tool',
			run: vi.fn(),
		};

		const wrapped = wrapTool(gate, originalTool, { id: 'u1', roles: ['user'] });
		const result = await wrapped.run({});
		expect(result).toContain('[AgentGate DENIED]');
		expect(originalTool.run).not.toHaveBeenCalled();
	});

	it('resolves identity from function', async () => {
		const gate = createMockGate('allow');
		const originalTool = {
			name: 'tool',
			run: vi.fn().mockReturnValue('ok'),
		};
		const identityFn = vi.fn().mockResolvedValue({ id: 'resolved', roles: ['admin'] });

		const wrapped = wrapTool(gate, originalTool, identityFn);
		await wrapped.run({ some: 'input' });

		expect(identityFn).toHaveBeenCalledWith({ some: 'input' });
		expect(gate.evaluate).toHaveBeenCalledWith(
			expect.objectContaining({
				identity: { id: 'resolved', roles: ['admin'] },
			}),
		);
	});
});

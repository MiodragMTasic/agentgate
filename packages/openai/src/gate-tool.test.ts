import { describe, it, expect, vi } from 'vitest';
import { gateTool } from './gate-tool.js';
import type { AgentGate } from '@agentgate/core';
import { GateDeniedError } from '@agentgate/core';

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

describe('gateTool (OpenAI)', () => {
	it('creates gated tool with definition and executor', async () => {
		const gate = createMockGate('allow');
		const executeFn = vi.fn().mockResolvedValue({ temp: 72, condition: 'sunny' });

		const tool = gateTool(gate, {
			definition: {
				type: 'function',
				function: {
					name: 'get_weather',
					description: 'Get weather for a location',
					parameters: { type: 'object', properties: { location: { type: 'string' } } },
				},
			},
			execute: executeFn,
			identity: { id: 'user_1', roles: ['user'] },
		});

		expect(tool.definition.function.name).toBe('get_weather');

		const result = await tool.execute({ location: 'NYC' });
		expect(result).toEqual({ temp: 72, condition: 'sunny' });
		expect(executeFn).toHaveBeenCalledWith({ location: 'NYC' });
		expect(gate.evaluate).toHaveBeenCalledWith({
			tool: 'get_weather',
			params: { location: 'NYC' },
			identity: { id: 'user_1', roles: ['user'] },
		});
	});

	it('throws GateDeniedError when policy denies', async () => {
		const gate = createMockGate('deny');
		const executeFn = vi.fn();

		const tool = gateTool(gate, {
			definition: {
				type: 'function',
				function: { name: 'delete_all', parameters: {} },
			},
			execute: executeFn,
			identity: { id: 'user_1', roles: ['user'] },
		});

		await expect(tool.execute({})).rejects.toThrow(GateDeniedError);
		expect(executeFn).not.toHaveBeenCalled();
	});

	it('GateDeniedError contains the decision', async () => {
		const gate = createMockGate('deny');

		const tool = gateTool(gate, {
			definition: {
				type: 'function',
				function: { name: 'blocked_tool', parameters: {} },
			},
			execute: vi.fn(),
			identity: { id: 'u1', roles: [] },
		});

		try {
			await tool.execute({});
			expect.fail('Should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(GateDeniedError);
			const gateErr = err as GateDeniedError;
			expect(gateErr.decision.verdict).toBe('deny');
			expect(gateErr.decision.reason).toBe('Denied by policy');
		}
	});

	it('resolves identity from function', async () => {
		const gate = createMockGate('allow');
		const identityFn = vi.fn().mockReturnValue({ id: 'dynamic', roles: ['admin'] });
		const executeFn = vi.fn().mockResolvedValue('result');

		const tool = gateTool(gate, {
			definition: {
				type: 'function',
				function: { name: 'tool', parameters: {} },
			},
			execute: executeFn,
			identity: identityFn,
		});

		await tool.execute({ arg: 'val' });
		expect(identityFn).toHaveBeenCalledWith({ arg: 'val' });
		expect(gate.evaluate).toHaveBeenCalledWith(
			expect.objectContaining({
				identity: { id: 'dynamic', roles: ['admin'] },
			}),
		);
	});

	it('throws GateDeniedError when pending_approval is not approved', async () => {
		const gate = createMockGate('pending_approval');
		const executeFn = vi.fn();

		const tool = gateTool(gate, {
			definition: {
				type: 'function',
				function: { name: 'deploy', parameters: {} },
			},
			execute: executeFn,
			identity: { id: 'u1', roles: ['user'] },
		});

		await expect(tool.execute({})).rejects.toThrow(GateDeniedError);
		expect(executeFn).not.toHaveBeenCalled();
	});

	it('executes when pending_approval is approved', async () => {
		const gate = createMockGate('pending_approval');
		(gate.waitForApproval as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		const executeFn = vi.fn().mockResolvedValue('deployed');

		const tool = gateTool(gate, {
			definition: {
				type: 'function',
				function: { name: 'deploy', parameters: {} },
			},
			execute: executeFn,
			identity: { id: 'u1', roles: ['user'] },
		});

		const result = await tool.execute({});
		expect(result).toBe('deployed');
		expect(executeFn).toHaveBeenCalled();
	});

	it('preserves the definition object', () => {
		const gate = createMockGate();
		const definition = {
			type: 'function' as const,
			function: {
				name: 'my_tool',
				description: 'Does something',
				parameters: { type: 'object', properties: { x: { type: 'number' } } },
			},
		};

		const tool = gateTool(gate, {
			definition,
			execute: vi.fn(),
			identity: { id: 'u', roles: [] },
		});

		expect(tool.definition).toBe(definition);
	});
});

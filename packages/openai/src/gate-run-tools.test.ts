import type { AgentGate } from '@miodragmtasic/agentgate-core';
import type { ChatCompletionToolRunnerParams } from 'openai/resources/beta/chat/completions';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { describe, expect, it, vi } from 'vitest';

import { gateRunToolsParams } from './gate-run-tools.js';

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

describe('gateRunToolsParams', () => {
	it('wraps runnable function tools and allows execution', async () => {
		const gate = createMockGate('allow');
		const originalFn = vi.fn().mockResolvedValue({ ok: true });

		const params = gateRunToolsParams(
			gate,
			{ id: 'user_1', roles: ['user'] },
			{
				model: 'gpt-4o-mini',
				messages: [{ role: 'user', content: 'hi' }],
				tools: [
					{
						type: 'function',
						function: {
							name: 'get_weather',
							description: 'Get the weather',
							parameters: { type: 'object', properties: { location: { type: 'string' } } },
							function: originalFn,
						},
					},
				],
			},
		);

		const result = await params.tools[0]?.function.function?.({ location: 'Toronto' });
		expect(result).toEqual({ ok: true });
		expect(gate.evaluate).toHaveBeenCalledWith({
			tool: 'get_weather',
			params: { location: 'Toronto' },
			identity: { id: 'user_1', roles: ['user'] },
		});
	});

	it('returns an encoded denial payload when policy denies', async () => {
		const gate = createMockGate('deny');
		const originalFn = vi.fn();
		const params = gateRunToolsParams(
			gate,
			{ id: 'user_1', roles: ['user'] },
			{
				model: 'gpt-4o-mini',
				messages: [{ role: 'user', content: 'hi' }],
				tools: [
					{
						type: 'function',
						function: {
							name: 'delete_data',
							parameters: { type: 'object' },
							function: originalFn,
						},
					},
				],
			},
		);

		const result = await params.tools[0]?.function.function?.({});
		expect(result).toBe('{"error":"Permission denied","reason":"Denied by policy"}');
		expect(originalFn).not.toHaveBeenCalled();
	});

	it('waits for approval before invoking the tool function', async () => {
		const gate = createMockGate('pending_approval');
		(gate.waitForApproval as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		const originalFn = vi.fn().mockResolvedValue({ ok: true });

		const params = gateRunToolsParams(
			gate,
			{ id: 'user_1', roles: ['user'] },
			{
				model: 'gpt-4o-mini',
				messages: [{ role: 'user', content: 'hi' }],
				tools: [
					{
						type: 'function',
						function: {
							name: 'deploy',
							parameters: { type: 'object' },
							function: originalFn,
						},
					},
				],
			},
		);

		const result = await params.tools[0]?.function.function?.({});
		expect(result).toEqual({ ok: true });
		expect(gate.waitForApproval).toHaveBeenCalledWith('apr_test');
		expect(originalFn).toHaveBeenCalled();
	});

	it('produces OpenAI-compatible tool and runner parameter shapes', () => {
		const gate = createMockGate('allow');
		const originalFn = vi.fn();
		const params = gateRunToolsParams(
			gate,
			{ id: 'user_1', roles: ['user'] },
			{
				model: 'gpt-4o-mini',
				messages: [{ role: 'user', content: 'hi' }],
				tools: [
					{
						type: 'function',
						function: {
							name: 'get_weather',
							description: 'Get the weather',
							parameters: { type: 'object', properties: { location: { type: 'string' } } },
							function: originalFn,
						},
					},
				],
			},
		);

		const toolDefinition: ChatCompletionTool = params.tools[0] as ChatCompletionTool;
		const typedParams: ChatCompletionToolRunnerParams<[string]> = params;

		expect(toolDefinition.function.name).toBe('get_weather');
		expect(typedParams.tools).toHaveLength(1);
	});
});

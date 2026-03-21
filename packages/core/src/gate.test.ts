import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fileSink } from './audit/index.js';
import { AgentGate } from './gate.js';
import type { ApprovalRequest, ApprovalResponse, HITLTransport } from './index.js';

const tempDirs: string[] = [];

function writeTempPolicy(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'agentgate-'));
	tempDirs.push(dir);
	const policyPath = join(dir, 'agentgate.policy.yml');
	writeFileSync(policyPath, contents, 'utf8');
	return policyPath;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe('AgentGate', () => {
	it('loads a YAML policy file before the first evaluation', async () => {
		const policyPath = writeTempPolicy(`
version: "1"

defaults:
  verdict: deny

roles:
  user: {}

tools:
  get_weather:
    allow:
      - roles: [user]
`);

		const gate = new AgentGate({ policies: policyPath });
		const decision = await gate.evaluate({
			tool: 'get_weather',
			params: { location: 'Toronto' },
			identity: { id: 'user_1', roles: ['user'] },
		});

		expect(decision.verdict).toBe('allow');
	});

	it('enforces policy-defined costs and budgets', async () => {
		const gate = new AgentGate({
			policies: {
				version: '1',
				defaults: { verdict: 'deny' },
				roles: {
					user: {},
				},
				tools: {
					manage_users: {
						allow: { roles: ['user'] },
						cost: 3,
						budget: {
							perUser: {
								daily: 5,
							},
						},
					},
				},
			},
		});

		const identity = { id: 'user_1', roles: ['user'] };

		const first = await gate.evaluate({
			tool: 'manage_users',
			params: {},
			identity,
		});
		const second = await gate.evaluate({
			tool: 'manage_users',
			params: {},
			identity,
		});
		const budget = await gate.getBudget(identity);

		expect(first.verdict).toBe('allow');
		expect(second.verdict).toBe('deny');
		expect(second.reason).toContain('Budget exceeded');
		expect(budget).not.toBeNull();
		expect(budget?.spent).toBe(3);
		expect(budget?.limit).toBe(5);
		expect(budget?.remaining).toBe(2);
	});

	it('allows waiting on an in-flight approval request', async () => {
		class DeferredTransport implements HITLTransport {
			private resolveResponse?: (response: ApprovalResponse) => void;

			async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
				return await new Promise<ApprovalResponse>((resolve) => {
					this.resolveResponse = resolve;
				});
			}

			resolve(requestId: string): void {
				this.resolveResponse?.({
					requestId,
					decision: 'approve',
					respondedBy: 'test',
					respondedAt: new Date(),
				});
			}
		}

		const transport = new DeferredTransport();
		const gate = new AgentGate({
			policies: {
				version: '1',
				defaults: { verdict: 'deny' },
				roles: {
					user: {},
				},
				tools: {
					send_email: {
						allow: { roles: ['user'] },
						requireApproval: {
							when: { roles: ['user'] },
						},
					},
				},
			},
			hitl: {
				transport,
			},
		});

		const approvalRequested = new Promise<string>((resolve) => {
			gate.on('approval:requested', (request) => {
				resolve((request as ApprovalRequest).id);
			});
		});

		const evaluation = gate.evaluate({
			tool: 'send_email',
			params: { to: 'user@example.com' },
			identity: { id: 'user_1', roles: ['user'] },
		});

		const approvalId = await approvalRequested;
		const waiting = gate.waitForApproval(approvalId);
		transport.resolve(approvalId);

		await expect(waiting).resolves.toBe(true);
		await expect(evaluation).resolves.toMatchObject({ verdict: 'allow' });
	});

	it('loads YAML policies from the built dist package', async () => {
		const distEntry = join(process.cwd(), 'dist/index.js');
		if (!existsSync(distEntry)) {
			return;
		}

		const policyPath = writeTempPolicy(`
version: "1"

defaults:
  verdict: deny

roles:
  user: {}

tools:
  query_database:
    allow:
      - roles: [user]
`);

		const { AgentGate: DistAgentGate } = await import('../dist/index.js');
		const gate = new DistAgentGate({ policies: policyPath });
		const decision = await gate.evaluate({
			tool: 'query_database',
			params: { table: 'users' },
			identity: { id: 'user_1', roles: ['user'] },
		});

		expect(decision.verdict).toBe('allow');
	});

	it('emits a timeout-specific denial when approval expires', async () => {
		const gate = new AgentGate({
			policies: {
				version: '1',
				defaults: { verdict: 'deny' },
				roles: {
					user: {},
				},
				tools: {
					send_email: {
						allow: { roles: ['user'] },
						requireApproval: {
							when: { roles: ['user'] },
						},
					},
				},
			},
			hitl: {
				timeout: 10,
				timeoutAction: 'deny',
				transport: {
					requestApproval: async () => {
						await new Promise(() => undefined);
						return {
							requestId: 'never',
							decision: 'deny',
							respondedBy: 'never',
							respondedAt: new Date(),
						};
					},
				},
			},
		});

		const expired = vi.fn();
		gate.on('approval:expired', expired);

		const decision = await gate.evaluate({
			tool: 'send_email',
			params: { to: 'user@example.com' },
			identity: { id: 'user_1', roles: ['user'] },
		});

		expect(decision.verdict).toBe('deny');
		expect(decision.reason).toContain('timed out');
		expect(expired).toHaveBeenCalledTimes(1);
	});

	it('persists audit events to the file sink before shutdown completes', async () => {
		const policyPath = writeTempPolicy(`
version: "1"

defaults:
  verdict: deny

roles:
  user: {}

tools:
  get_weather:
    allow:
      - roles: [user]
`);
		const auditPath = join(tempDirs[tempDirs.length - 1] ?? tmpdir(), 'audit.log');
		const gate = new AgentGate({
			policies: policyPath,
			audit: {
				sinks: [fileSink(auditPath)],
			},
		});

		await gate.evaluate({
			tool: 'get_weather',
			params: { location: 'Toronto' },
			identity: { id: 'user_1', roles: ['user'] },
		});
		await gate.shutdown();

		const logged = readFileSync(auditPath, 'utf8');
		expect(logged).toContain('"type":"tool:allowed"');
		expect(logged).toContain('"tool":"get_weather"');
	});

	it('enforces rate limits across concurrent requests for the same identity and tool', async () => {
		const gate = new AgentGate({
			policies: {
				version: '1',
				defaults: { verdict: 'deny' },
				roles: {
					user: {},
				},
				tools: {
					search_products: {
						allow: { roles: ['user'] },
						rateLimit: {
							maxRequests: 2,
							window: '1m',
						},
					},
				},
			},
		});

		const identity = { id: 'user_1', roles: ['user'] };
		const decisions = await Promise.all(
			Array.from({ length: 5 }, () =>
				gate.evaluate({
					tool: 'search_products',
					params: { query: 'widget' },
					identity,
				}),
			),
		);

		expect(decisions.filter((decision) => decision.verdict === 'allow')).toHaveLength(2);
		expect(decisions.filter((decision) => decision.verdict === 'deny')).toHaveLength(3);
		expect(decisions.some((decision) => decision.reason.includes('Rate limit exceeded'))).toBe(
			true,
		);
	});
});

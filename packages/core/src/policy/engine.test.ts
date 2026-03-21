import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PolicyEngine } from './engine.js';
import type { PolicySet } from './types.js';

function makeRequest(
	tool: string,
	roles: string[] = ['user'],
	params: Record<string, unknown> = {},
) {
	return {
		tool,
		params,
		identity: { id: 'user_1', roles },
	};
}

describe('PolicyEngine', () => {
	describe('allow rules', () => {
		it('allows when role matches an allow rule', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					read_file: {
						allow: { roles: ['user'] },
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('read_file', ['user']));
			expect(decision.verdict).toBe('allow');
			expect(decision.matchedRule).toBe('allow[0]');
		});

		it('allows when no roles specified on rule (open to all)', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					read_file: {
						allow: {},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('read_file', ['anyone']));
			expect(decision.verdict).toBe('allow');
		});

		it('allows with array of allow rules', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					read_file: {
						allow: [{ roles: ['admin'] }, { roles: ['editor'] }],
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('read_file', ['editor']));
			expect(decision.verdict).toBe('allow');
			expect(decision.matchedRule).toBe('allow[1]');
		});
	});

	describe('deny rules', () => {
		it('denies when role matches a deny rule', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					delete_data: {
						allow: { roles: ['user'] },
						deny: { roles: ['user'] },
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('delete_data', ['user']));
			expect(decision.verdict).toBe('deny');
		});

		it('deny takes precedence over allow', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					dangerous_tool: {
						allow: { roles: ['admin'] },
						deny: { roles: ['admin'] },
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('dangerous_tool', ['admin']));
			expect(decision.verdict).toBe('deny');
			expect(decision.matchedRule).toBe('deny[0]');
		});

		it('deny with no roles blocks everyone', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					blocked_tool: {
						allow: { roles: ['admin'] },
						deny: {},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('blocked_tool', ['admin']));
			expect(decision.verdict).toBe('deny');
		});
	});

	describe('role inheritance', () => {
		it('admin inherits power_user which inherits user', () => {
			const policies: PolicySet = {
				version: '1',
				roles: {
					user: {},
					power_user: { inherits: ['user'] },
					admin: { inherits: ['power_user'] },
				},
				tools: {
					read_file: {
						allow: { roles: ['user'] },
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('read_file', ['admin']));
			expect(decision.verdict).toBe('allow');
		});

		it('user does not inherit admin privileges', () => {
			const policies: PolicySet = {
				version: '1',
				roles: {
					user: {},
					admin: { inherits: ['user'] },
				},
				tools: {
					admin_tool: {
						allow: { roles: ['admin'] },
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('admin_tool', ['user']));
			expect(decision.verdict).toBe('deny');
		});
	});

	describe('wildcard tool matching', () => {
		it('matches database.* pattern', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					'database.*': {
						allow: { roles: ['user'] },
					},
				},
			};
			const engine = new PolicyEngine(policies);
			expect(engine.evaluate(makeRequest('database.query', ['user'])).verdict).toBe('allow');
			expect(engine.evaluate(makeRequest('database.write', ['user'])).verdict).toBe('allow');
		});

		it('does not match across dots for single wildcard', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					'database.*': {
						allow: { roles: ['user'] },
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('database.schema.drop', ['user']));
			expect(decision.verdict).toBe('deny');
		});

		it('** matches across dots', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					'database.**': {
						allow: { roles: ['user'] },
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('database.schema.drop', ['user']));
			expect(decision.verdict).toBe('allow');
		});

		it('exact match takes precedence over wildcard', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					'database.*': {
						allow: { roles: ['user'] },
					},
					'database.drop': {
						deny: {},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('database.drop', ['user']));
			expect(decision.verdict).toBe('deny');
		});
	});

	describe('default verdict', () => {
		it('default deny when no rule matches', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					some_tool: {
						allow: { roles: ['admin'] },
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('some_tool', ['user']));
			expect(decision.verdict).toBe('deny');
			expect(decision.reason).toContain('No allow rule matched');
		});

		it('default deny when no tool policy found', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('unknown_tool'));
			expect(decision.verdict).toBe('deny');
			expect(decision.reason).toContain('No policy found');
		});

		it('default allow when configured', () => {
			const policies: PolicySet = {
				version: '1',
				defaults: { verdict: 'allow' },
				tools: {},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('unknown_tool'));
			expect(decision.verdict).toBe('allow');
			expect(decision.reason).toContain('default: allow');
		});

		it('default allow when no allow rule matches but defaults.verdict is allow', () => {
			const policies: PolicySet = {
				version: '1',
				defaults: { verdict: 'allow' },
				tools: {
					some_tool: {
						allow: { roles: ['admin'] },
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('some_tool', ['user']));
			expect(decision.verdict).toBe('allow');
			expect(decision.reason).toContain('Default allow');
		});
	});

	describe('parameter constraints', () => {
		it('allows when pattern matches', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					read_file: {
						allow: {
							roles: ['user'],
							params: { path: { pattern: '^/safe/' } },
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(
				makeRequest('read_file', ['user'], { path: '/safe/file.txt' }),
			);
			expect(decision.verdict).toBe('allow');
		});

		it('denies when pattern does not match', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					read_file: {
						allow: {
							roles: ['user'],
							params: { path: { pattern: '^/safe/' } },
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(
				makeRequest('read_file', ['user'], { path: '/etc/passwd' }),
			);
			expect(decision.verdict).toBe('deny');
		});

		it('denies when contains matches blocked values', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					run_query: {
						allow: { roles: ['user'] },
						deny: {
							roles: ['user'],
							params: { query: { contains: ['DROP', 'DELETE'] } },
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(
				makeRequest('run_query', ['user'], { query: 'DROP TABLE users' }),
			);
			expect(decision.verdict).toBe('deny');
		});

		it('handles min/max number constraints', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					set_limit: {
						allow: {
							roles: ['user'],
							params: { count: { min: 1, max: 100 } },
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			expect(
				engine.evaluate(makeRequest('set_limit', ['user'], { count: 50 })).verdict,
			).toBe('allow');
			expect(
				engine.evaluate(makeRequest('set_limit', ['user'], { count: 200 })).verdict,
			).toBe('deny');
			expect(
				engine.evaluate(makeRequest('set_limit', ['user'], { count: 0 })).verdict,
			).toBe('deny');
		});

		it('handles maxLength constraint', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					send_message: {
						allow: {
							roles: ['user'],
							params: { message: { maxLength: 10 } },
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			expect(
				engine.evaluate(makeRequest('send_message', ['user'], { message: 'hi' })).verdict,
			).toBe('allow');
			expect(
				engine.evaluate(
					makeRequest('send_message', ['user'], { message: 'this is too long!' }),
				).verdict,
			).toBe('deny');
		});

		it('handles forbidden parameter', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					query: {
						allow: {
							roles: ['user'],
							params: { admin_override: { forbidden: true } },
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			expect(
				engine.evaluate(makeRequest('query', ['user'], {})).verdict,
			).toBe('allow');
			expect(
				engine.evaluate(makeRequest('query', ['user'], { admin_override: true })).verdict,
			).toBe('deny');
		});
	});

	describe('approval requirement detection', () => {
		it('returns pending_approval when requireApproval is set', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					deploy: {
						allow: { roles: ['developer'] },
						requireApproval: {},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('deploy', ['developer']));
			expect(decision.verdict).toBe('pending_approval');
			expect(decision.approvalId).toBeDefined();
			expect(decision.approvalId).toMatch(/^apr_/);
		});

		it('skips approval when when-condition does not match', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					deploy: {
						allow: { roles: ['developer'] },
						requireApproval: {
							when: { roles: ['junior'] },
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('deploy', ['developer']));
			expect(decision.verdict).toBe('allow');
		});

		it('requires approval when when-condition matches', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {
					deploy: {
						allow: { roles: ['developer'] },
						requireApproval: {
							when: { roles: ['developer'] },
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('deploy', ['developer']));
			expect(decision.verdict).toBe('pending_approval');
		});
	});

	describe('time-based conditions', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it('allows when within allowed time window', () => {
			// Set to Wednesday at 10:00 AM
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-03-18T10:00:00'));

			const policies: PolicySet = {
				version: '1',
				tools: {
					deploy: {
						allow: {
							roles: ['user'],
							conditions: {
								business_hours: {
									time: {
										days: ['mon', 'tue', 'wed', 'thu', 'fri'],
										hours: { after: '09:00', before: '17:00' },
									},
								},
							},
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('deploy', ['user']));
			expect(decision.verdict).toBe('allow');
		});

		it('denies when outside allowed time window', () => {
			// Set to Wednesday at 20:00 (8 PM)
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-03-18T20:00:00'));

			const policies: PolicySet = {
				version: '1',
				tools: {
					deploy: {
						allow: {
							roles: ['user'],
							conditions: {
								business_hours: {
									time: {
										days: ['mon', 'tue', 'wed', 'thu', 'fri'],
										hours: { after: '09:00', before: '17:00' },
									},
								},
							},
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('deploy', ['user']));
			expect(decision.verdict).toBe('deny');
		});

		it('denies when on a non-allowed day', () => {
			// Set to Saturday at 10:00 AM  (2026-03-21 is a Saturday)
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-03-21T10:00:00'));

			const policies: PolicySet = {
				version: '1',
				tools: {
					deploy: {
						allow: {
							roles: ['user'],
							conditions: {
								weekday_only: {
									time: {
										days: ['mon', 'tue', 'wed', 'thu', 'fri'],
									},
								},
							},
						},
					},
				},
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('deploy', ['user']));
			expect(decision.verdict).toBe('deny');
		});
	});

	describe('decision metadata', () => {
		it('includes evaluationTimeMs, decisionId, and timestamp', () => {
			const policies: PolicySet = {
				version: '1',
				tools: { t: { allow: {} } },
			};
			const engine = new PolicyEngine(policies);
			const decision = engine.evaluate(makeRequest('t'));
			expect(decision.evaluationTimeMs).toBeGreaterThanOrEqual(0);
			expect(decision.decisionId).toMatch(/^dec_/);
			expect(decision.timestamp).toBeInstanceOf(Date);
		});
	});

	describe('reload', () => {
		it('replaces policies on reload', () => {
			const policies: PolicySet = {
				version: '1',
				tools: {},
			};
			const engine = new PolicyEngine(policies);
			expect(engine.evaluate(makeRequest('tool_a')).verdict).toBe('deny');

			engine.reload({
				version: '1',
				tools: { tool_a: { allow: {} } },
			});
			expect(engine.evaluate(makeRequest('tool_a')).verdict).toBe('allow');
		});
	});

	describe('utility methods', () => {
		it('getToolNames returns tool names', () => {
			const policies: PolicySet = {
				version: '1',
				tools: { a: { allow: {} }, b: { deny: {} } },
			};
			const engine = new PolicyEngine(policies);
			expect(engine.getToolNames()).toEqual(['a', 'b']);
		});

		it('getToolPolicy returns the policy for a tool', () => {
			const policies: PolicySet = {
				version: '1',
				tools: { a: { allow: { roles: ['user'] } } },
			};
			const engine = new PolicyEngine(policies);
			const tp = engine.getToolPolicy('a');
			expect(tp).toBeDefined();
			expect(tp!.allow).toEqual({ roles: ['user'] });
		});

		it('getToolPolicy returns undefined for unknown tool', () => {
			const policies: PolicySet = { version: '1', tools: {} };
			const engine = new PolicyEngine(policies);
			expect(engine.getToolPolicy('nope')).toBeUndefined();
		});
	});
});

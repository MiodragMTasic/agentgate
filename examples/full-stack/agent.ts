/**
 * AgentGate — Full-Stack Example
 *
 * A comprehensive example showing all AgentGate features working together:
 *   - Role-based access control with inheritance
 *   - Parameter constraints (patterns, enums, ranges, length limits)
 *   - Rate limiting with different scopes
 *   - Budget tracking with per-user limits
 *   - Human-in-the-loop approval flows
 *   - Reusable named conditions (time and expression-based)
 *   - Audit logging with console sink
 *   - Capability discovery
 *   - Event system
 *
 * Run: pnpm start
 */

import { createGateToolRunner, gateTool } from '@miodragmtasic/agentgate-anthropic';
import {
	AgentGate,
	type ApprovalRequest,
	type ApprovalResponse,
	ConsoleTransport,
	type HITLTransport,
	type Identity,
	consoleSink,
} from '@miodragmtasic/agentgate-core';

// ── 1. Auto-approve transport for demo ────────────────────────────

class DemoTransport implements HITLTransport {
	async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
		console.log('\n  >> APPROVAL REQUEST <<');
		console.log(`     Tool:    ${request.tool}`);
		console.log(`     Agent:   ${request.identity.id}`);
		console.log(`     Reason:  ${request.reason}`);
		console.log(`     Params:  ${JSON.stringify(request.params)}`);
		console.log('     >> AUTO-APPROVED for demo\n');
		return {
			requestId: request.id,
			decision: 'approve',
			respondedBy: 'demo-transport',
			respondedAt: new Date(),
		};
	}
}

// ── 2. Create gate with all features ──────────────────────────────

const gate = new AgentGate({
	policies: new URL('./agentgate.policy.yml', import.meta.url).pathname,
	audit: {
		sinks: [consoleSink()],
		logAllowed: true,
		redactParams: ['ssn', 'creditCard', 'password'],
	},
	hitl: {
		transport: new DemoTransport(),
		timeout: 300_000,
		timeoutAction: 'deny',
	},
	budget: {
		costs: {
			update_order: 0.1,
			send_notification: 0.05,
			create_discount_code: 0.5,
			modify_pricing: 1.0,
		},
	},
	debug: true,
});

// ── 3. Event listeners ────────────────────────────────────────────

gate.on('decision', (event) => {
	// You could send this to Datadog, Sentry, etc.
});

gate.on('rate-limit:hit', (data) => {
	const info = data as { tool: string; identity: Identity };
	console.log(`  [Rate Limit] ${info.identity.id} hit limit on ${info.tool}`);
});

gate.on('budget:exceeded', (data) => {
	const info = data as { tool: string; identity: Identity };
	console.log(`  [Budget] ${info.identity.id} exceeded budget on ${info.tool}`);
});

// ── 4. Define user tiers ──────────────────────────────────────────

const freeUser: Identity = {
	id: 'user_free_01',
	roles: ['free_user'],
	orgId: 'org_starter',
	attributes: { plan: 'free', region: 'us-east' },
};

const proUser: Identity = {
	id: 'user_pro_01',
	roles: ['pro_user'],
	orgId: 'org_growth',
	attributes: { plan: 'pro', region: 'us-west' },
};

const enterpriseUser: Identity = {
	id: 'user_ent_01',
	roles: ['enterprise_user'],
	orgId: 'org_enterprise',
	attributes: { plan: 'enterprise', region: 'eu-west' },
};

const internalAgent: Identity = {
	id: 'system_agent_01',
	roles: ['internal_agent'],
	attributes: { service: 'order-processor' },
};

// ── 5. Create tools ───────────────────────────────────────────────

function createTools(identity: Identity) {
	return {
		searchProducts: gateTool(gate, {
			name: 'search_products',
			description: 'Search the product catalog',
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string' },
					limit: { type: 'number' },
				},
				required: ['query'],
			},
			identity,
			run: async (input) =>
				JSON.stringify({
					products: [
						{ id: 'P001', name: 'Widget Pro', price: 29.99 },
						{ id: 'P002', name: 'Gadget X', price: 49.99 },
					],
					query: input.query,
				}),
		}),

		getOrderStatus: gateTool(gate, {
			name: 'get_order_status',
			description: 'Check order status by ID',
			inputSchema: {
				type: 'object',
				properties: {
					orderId: { type: 'string', pattern: '^ORD-[0-9]{4}-[A-Z0-9]+$' },
				},
				required: ['orderId'],
			},
			identity,
			run: async (input) =>
				JSON.stringify({
					orderId: input.orderId,
					status: 'shipped',
					eta: '2026-03-22',
				}),
		}),

		getCustomerProfile: gateTool(gate, {
			name: 'get_customer_profile',
			description: 'Get customer profile data',
			inputSchema: {
				type: 'object',
				properties: {
					customerId: { type: 'string' },
					fields: { type: 'array', items: { type: 'string' } },
				},
				required: ['customerId'],
			},
			identity,
			run: async (input) =>
				JSON.stringify({
					id: input.customerId,
					name: 'Jane Doe',
					email: 'jane@example.com',
				}),
		}),

		updateOrder: gateTool(gate, {
			name: 'update_order',
			description: 'Update order status',
			inputSchema: {
				type: 'object',
				properties: {
					orderId: { type: 'string' },
					status: { type: 'string', enum: ['processing', 'shipped', 'delivered', 'returned'] },
				},
				required: ['orderId', 'status'],
			},
			identity,
			run: async (input) =>
				JSON.stringify({ updated: true, orderId: input.orderId, status: input.status }),
		}),

		sendNotification: gateTool(gate, {
			name: 'send_notification',
			description: 'Send a notification via email, SMS, or push',
			inputSchema: {
				type: 'object',
				properties: {
					userId: { type: 'string' },
					channel: { type: 'string', enum: ['email', 'sms', 'push'] },
					message: { type: 'string' },
				},
				required: ['userId', 'channel', 'message'],
			},
			identity,
			run: async (input) => JSON.stringify({ sent: true, channel: input.channel }),
		}),

		createDiscountCode: gateTool(gate, {
			name: 'create_discount_code',
			description: 'Create a discount code',
			inputSchema: {
				type: 'object',
				properties: {
					code: { type: 'string' },
					percentage: { type: 'number' },
					maxUses: { type: 'number' },
				},
				required: ['code', 'percentage'],
			},
			identity,
			run: async (input) =>
				JSON.stringify({ created: true, code: input.code, percentage: input.percentage }),
		}),

		modifyPricing: gateTool(gate, {
			name: 'modify_pricing',
			description: 'Modify product pricing',
			inputSchema: {
				type: 'object',
				properties: {
					productId: { type: 'string' },
					changePercent: { type: 'number' },
				},
				required: ['productId', 'changePercent'],
			},
			identity,
			run: async (input) =>
				JSON.stringify({
					updated: true,
					productId: input.productId,
					changePercent: input.changePercent,
				}),
		}),

		purgeCache: gateTool(gate, {
			name: 'purge_cache',
			description: 'Purge system cache',
			inputSchema: {
				type: 'object',
				properties: {
					scope: { type: 'string', enum: ['product', 'user', 'order', 'all'] },
				},
				required: ['scope'],
			},
			identity,
			run: async (input) => JSON.stringify({ purged: true, scope: input.scope }),
		}),
	};
}

// ── 6. Run the demo ───────────────────────────────────────────────

async function main() {
	console.log('\n========================================');
	console.log('  AgentGate — Full-Stack Example');
	console.log('========================================\n');

	// ── Free User Tests ─────────────────────────────────────────────
	console.log('╔═══════════════════════════════════════╗');
	console.log('║  FREE USER                            ║');
	console.log('╚═══════════════════════════════════════╝\n');

	const freeTools = createTools(freeUser);

	console.log('1. Search products (should ALLOW):');
	console.log(
		'  ',
		await freeTools.searchProducts.run({ query: 'wireless headphones', limit: 10 }),
	);

	console.log('\n2. Get order status (should ALLOW):');
	console.log('  ', await freeTools.getOrderStatus.run({ orderId: 'ORD-2024-A1B2C3' }));

	console.log('\n3. Get customer profile (should DENY — pro+ only):');
	console.log('  ', await freeTools.getCustomerProfile.run({ customerId: 'C001' }));

	console.log('\n4. Update order (should DENY — pro+ only):');
	console.log(
		'  ',
		await freeTools.updateOrder.run({ orderId: 'ORD-2024-A1B2C3', status: 'shipped' }),
	);

	// ── Pro User Tests ──────────────────────────────────────────────
	console.log('\n╔═══════════════════════════════════════╗');
	console.log('║  PRO USER                             ║');
	console.log('╚═══════════════════════════════════════╝\n');

	const proTools = createTools(proUser);

	console.log('5. Get customer profile (should ALLOW):');
	console.log(
		'  ',
		await proTools.getCustomerProfile.run({ customerId: 'C001', fields: ['name', 'email'] }),
	);

	console.log('\n6. Get customer profile with sensitive fields (should DENY):');
	console.log(
		'  ',
		await proTools.getCustomerProfile.run({ customerId: 'C001', fields: ['name', 'ssn'] }),
	);

	console.log('\n7. Update order (should ALLOW):');
	console.log('  ', await proTools.updateOrder.run({ orderId: 'ORD-2024-X1', status: 'shipped' }));

	console.log('\n8. Create discount code (should DENY — enterprise+ only):');
	console.log('  ', await proTools.createDiscountCode.run({ code: 'SAVE20', percentage: 20 }));

	// ── Enterprise User Tests ───────────────────────────────────────
	console.log('\n╔═══════════════════════════════════════╗');
	console.log('║  ENTERPRISE USER                      ║');
	console.log('╚═══════════════════════════════════════╝\n');

	const entTools = createTools(enterpriseUser);

	console.log('9. Create discount code (should ALLOW):');
	console.log(
		'  ',
		await entTools.createDiscountCode.run({ code: 'VIP30', percentage: 30, maxUses: 500 }),
	);

	console.log('\n10. Create discount > 50% (should DENY — param limit):');
	console.log(
		'  ',
		await entTools.createDiscountCode.run({ code: 'HUGE75', percentage: 75, maxUses: 10 }),
	);

	console.log('\n11. Modify pricing by 5% (should ALLOW):');
	console.log('  ', await entTools.modifyPricing.run({ productId: 'P001', changePercent: 5 }));

	console.log('\n12. Modify pricing by -15% (should require APPROVAL):');
	console.log('  ', await entTools.modifyPricing.run({ productId: 'P002', changePercent: -15 }));

	console.log('\n13. Purge cache (should DENY — internal only):');
	console.log('  ', await entTools.purgeCache.run({ scope: 'product' }));

	// ── Internal Agent Tests ────────────────────────────────────────
	console.log('\n╔═══════════════════════════════════════╗');
	console.log('║  INTERNAL AGENT                       ║');
	console.log('╚═══════════════════════════════════════╝\n');

	const intTools = createTools(internalAgent);

	console.log('14. Purge cache (should ALLOW):');
	console.log('  ', await intTools.purgeCache.run({ scope: 'all' }));

	// ── Capability Discovery ────────────────────────────────────────
	console.log('\n╔═══════════════════════════════════════╗');
	console.log('║  CAPABILITY DISCOVERY                 ║');
	console.log('╚═══════════════════════════════════════╝\n');

	const tiers = [
		{ name: 'Free', identity: freeUser },
		{ name: 'Pro', identity: proUser },
		{ name: 'Enterprise', identity: enterpriseUser },
		{ name: 'Internal', identity: internalAgent },
	];

	for (const tier of tiers) {
		const caps = gate.discover(tier.identity);
		console.log(`  ${tier.name} (${tier.identity.id}):`);
		console.log(`    ${JSON.stringify(caps)}\n`);
	}

	// ── Budget Status ───────────────────────────────────────────────
	console.log('╔═══════════════════════════════════════╗');
	console.log('║  BUDGET STATUS                        ║');
	console.log('╚═══════════════════════════════════════╝\n');

	for (const tier of tiers) {
		const budget = await gate.getBudget(tier.identity);
		if (budget) {
			console.log(`  ${tier.name}: ${JSON.stringify(budget)}`);
		}
	}

	// ── GateToolRunner Pattern ──────────────────────────────────────
	console.log('\n╔═══════════════════════════════════════╗');
	console.log('║  GATE TOOL RUNNER                     ║');
	console.log('╚═══════════════════════════════════════╝\n');

	const runner = createGateToolRunner(gate, proUser);

	const rawTools = [
		{
			name: 'search_products',
			run: async (input: unknown) => JSON.stringify({ results: ['Widget'] }),
		},
		{
			name: 'purge_cache',
			run: async (input: unknown) => JSON.stringify({ purged: true }),
		},
	];

	const wrappedTools = runner.wrapTools(rawTools);
	const searchRunner = wrappedTools[0];
	const purgeRunner = wrappedTools[1];

	if (!searchRunner || !purgeRunner) {
		throw new Error('Expected wrapped tools for search_products and purge_cache.');
	}

	console.log('15. Pro user search via runner (should ALLOW):');
	console.log('  ', await searchRunner.run({ query: 'test', limit: 5 }));

	console.log('\n16. Pro user purge_cache via runner (should DENY):');
	console.log('  ', await purgeRunner.run({ scope: 'all' }));

	// ── Cleanup ─────────────────────────────────────────────────────
	await gate.shutdown();
	console.log('\n========================================');
	console.log('  Done');
	console.log('========================================\n');
}

main().catch(console.error);

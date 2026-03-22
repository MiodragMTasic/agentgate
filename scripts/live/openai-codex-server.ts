import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { AgentGate, type ApprovalRequest, customSink } from '@miodragmtasic/agentgate-core';
import { GateMcpServer } from '@miodragmtasic/agentgate-mcp';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { ScriptedApprovalTransport, approvedByScript, deniedByScript, sanitize } from './shared.js';

const scenarioId = process.env.AGENTGATE_OPENAI_SCENARIO_ID ?? '';
const caseId = process.env.AGENTGATE_OPENAI_CASE_ID ?? '';
const sessionId = process.env.AGENTGATE_OPENAI_SESSION_ID ?? `codex-${scenarioId}-${caseId}`;
const auditPath = process.env.AGENTGATE_OPENAI_AUDIT_PATH;

const auditEvents: unknown[] = [];
const approvalEvents: Array<{ type: string; tool: string; reason: string }> = [];

interface ScenarioConfig {
	policyPath: string;
	identity: {
		id: string;
		roles: string[];
		orgId?: string;
	};
	resolveApproval?: (request: ApprovalRequest) => ReturnType<typeof approvedByScript>;
	register: (server: GateMcpServer) => void;
	prewarm?: (server: GateMcpServer) => Promise<void>;
}

function getScenarioConfig(id: string): ScenarioConfig {
	switch (id) {
		case 'internal-database-copilot':
			return {
				policyPath: 'scripts/live/fixtures/openai-database-copilot.policy.yml',
				identity: {
					id: 'openai_db_analyst',
					roles: ['data_analyst'],
					orgId: 'org_data',
				},
				register: (server) => {
					server.registerTool(
						'query_database',
						{
							title: 'Query Database',
							description: 'Run a read-only database query against approved public tables.',
							inputSchema: {
								type: 'object',
								properties: {
									query: { type: 'string' },
									table: { type: 'string' },
								},
								required: ['query', 'table'],
							},
						},
						async (args) => ({
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										rows: [
											{ orderId: 'ORD-3001', total: 199.5 },
											{ orderId: 'ORD-3002', total: 89.0 },
											{ orderId: 'ORD-3003', total: 42.75 },
										],
										table: args.table,
										query: args.query,
									}),
								},
							],
						}),
					);
				},
			};
		case 'finance-credits-payouts':
			return {
				policyPath: 'scripts/live/fixtures/openai-finance-credits.policy.yml',
				identity: {
					id: 'openai_finance_manager',
					roles: ['finance_manager'],
					orgId: 'org_finance',
				},
				resolveApproval: (request) =>
					Number(request.params.amount ?? 0) >= 500
						? approvedByScript(request, 'finance-approver', 'Approved for live proof')
						: deniedByScript(request, 'finance-approver', 'Unexpected approval request'),
				register: (server) => {
					server.registerTool(
						'draft_store_credit',
						{
							title: 'Draft Store Credit',
							description: 'Draft a low-risk store credit for a customer.',
							inputSchema: {
								type: 'object',
								properties: {
									customerId: { type: 'string' },
									amount: { type: 'number' },
									reason: { type: 'string' },
								},
								required: ['customerId', 'amount', 'reason'],
							},
						},
						async (args) => ({
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										drafted: true,
										customerId: args.customerId,
										amount: args.amount,
										reason: args.reason,
									}),
								},
							],
						}),
					);
					server.registerTool(
						'issue_vendor_payout',
						{
							title: 'Issue Vendor Payout',
							description: 'Schedule a vendor payout after approval.',
							inputSchema: {
								type: 'object',
								properties: {
									vendorId: { type: 'string' },
									amount: { type: 'number' },
									currency: { type: 'string' },
								},
								required: ['vendorId', 'amount', 'currency'],
							},
						},
						async (args) => ({
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										payoutScheduled: true,
										vendorId: args.vendorId,
										amount: args.amount,
										currency: args.currency,
									}),
								},
							],
						}),
					);
					server.registerTool(
						'update_bank_details',
						{
							title: 'Update Bank Details',
							description: 'Update vendor bank details.',
							inputSchema: {
								type: 'object',
								properties: {
									vendorId: { type: 'string' },
									accountNumber: { type: 'string' },
								},
								required: ['vendorId', 'accountNumber'],
							},
						},
						async (args) => ({
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										updated: true,
										vendorId: args.vendorId,
									}),
								},
							],
						}),
					);
				},
				prewarm: async (server) => {
					if (caseId !== 'deny-budget-exceeded') {
						return;
					}
					await server.callTool(
						'issue_vendor_payout',
						{
							vendorId: 'V-204',
							amount: 750,
							currency: 'USD',
						},
						{
							sessionId,
							role: 'finance_manager',
						},
					);
				},
			};
		case 'legal-compliance-assistant':
			return {
				policyPath: 'scripts/live/fixtures/openai-legal-compliance.policy.yml',
				identity: {
					id: 'openai_legal_analyst',
					roles: ['legal_analyst'],
					orgId: 'org_legal',
				},
				register: (server) => {
					server.registerTool(
						'extract_contract_clauses',
						{
							title: 'Extract Contract Clauses',
							description: 'Extract important clauses from a contract.',
							inputSchema: {
								type: 'object',
								properties: {
									documentId: { type: 'string' },
									clauseTypes: { type: 'array', items: { type: 'string' } },
								},
								required: ['documentId', 'clauseTypes'],
							},
						},
						async (args) => ({
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										documentId: args.documentId,
										clauses: [
											{
												type: 'termination',
												excerpt: 'Either party may terminate with 30 days notice.',
											},
											{
												type: 'indemnity',
												excerpt: 'Vendor shall indemnify the customer for direct claims.',
											},
										],
									}),
								},
							],
						}),
					);
					server.registerTool(
						'send_legal_notice',
						{
							title: 'Send Legal Notice',
							description: 'Send a final legal notice to a counterparty.',
							inputSchema: {
								type: 'object',
								properties: {
									counterparty: { type: 'string' },
									subject: { type: 'string' },
								},
								required: ['counterparty', 'subject'],
							},
						},
						async (args) => ({
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										sent: true,
										counterparty: args.counterparty,
									}),
								},
							],
						}),
					);
				},
			};
		case 'ecommerce-catalog-pricing':
			return {
				policyPath: 'scripts/live/fixtures/openai-ecommerce-pricing.policy.yml',
				identity: {
					id: 'openai_merchandiser',
					roles: ['merchandiser'],
					orgId: 'org_commerce',
				},
				resolveApproval: (request) =>
					deniedByScript(request, 'pricing-manager', 'Pricing manager denied the requested change'),
				register: (server) => {
					server.registerTool(
						'lookup_catalog',
						{
							title: 'Lookup Catalog',
							description: 'Look up product data from the product catalog.',
							inputSchema: {
								type: 'object',
								properties: {
									productId: { type: 'string' },
								},
								required: ['productId'],
							},
						},
						async (args) => ({
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										productId: args.productId,
										name: 'Aero Kettle',
										price: 129.0,
										inventory: 48,
									}),
								},
							],
						}),
					);
					server.registerTool(
						'modify_pricing',
						{
							title: 'Modify Pricing',
							description: 'Adjust a product price by a percentage.',
							inputSchema: {
								type: 'object',
								properties: {
									productId: { type: 'string' },
									changePercent: { type: 'number' },
								},
								required: ['productId', 'changePercent'],
							},
						},
						async (args) => ({
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										updated: true,
										productId: args.productId,
										changePercent: args.changePercent,
									}),
								},
							],
						}),
					);
				},
			};
		case 'multitenant-saas-admin':
			return {
				policyPath: 'scripts/live/fixtures/openai-multitenant-admin.policy.yml',
				identity: {
					id: 'openai_support_admin',
					roles: ['support_admin'],
					orgId: 'org_acme',
				},
				register: (server) => {
					server.registerTool(
						'inspect_tenant_settings',
						{
							title: 'Inspect Tenant Settings',
							description: 'Inspect a tenant configuration record.',
							inputSchema: {
								type: 'object',
								properties: {
									tenantId: { type: 'string' },
								},
								required: ['tenantId'],
							},
						},
						async (args) => ({
							content: [
								{
									type: 'text',
									text: JSON.stringify({
										tenantId: args.tenantId,
										sso: 'enabled',
										region: 'us-east-1',
									}),
								},
							],
						}),
					);
				},
			};
		default:
			throw new Error(`Unhandled OpenAI scenario: ${id}`);
	}
}

const scenario = getScenarioConfig(scenarioId);

const gate = new AgentGate({
	policies: scenario.policyPath,
	audit: {
		sinks: [
			customSink('openai-codex-proof', (event) => {
				auditEvents.push(sanitize(event));
			}),
		],
		logAllowed: true,
	},
	hitl: scenario.resolveApproval
		? { transport: new ScriptedApprovalTransport(scenario.resolveApproval) }
		: undefined,
	debug: true,
});

gate.on('approval:requested', (request) => {
	const typed = request as ApprovalRequest;
	approvalEvents.push({ type: 'approval:requested', tool: typed.tool, reason: typed.reason });
});
gate.on('approval:approved', (request) => {
	const typed = request as ApprovalRequest;
	approvalEvents.push({ type: 'approval:approved', tool: typed.tool, reason: typed.reason });
});
gate.on('approval:denied', (request) => {
	const typed = request as ApprovalRequest;
	approvalEvents.push({ type: 'approval:denied', tool: typed.tool, reason: typed.reason });
});
gate.on('approval:expired', (request) => {
	const typed = request as ApprovalRequest;
	approvalEvents.push({ type: 'approval:expired', tool: typed.tool, reason: typed.reason });
});

const gateServer = new GateMcpServer(
	{
		name: 'agentgate-openai-live-proof',
		version: '0.1.0',
		description: 'Codex live-proof server for AgentGate OpenAI scenarios',
	},
	gate,
	() => ({
		...scenario.identity,
		id: sessionId,
	}),
);

scenario.register(gateServer);

async function persistAuditLog(): Promise<void> {
	if (!auditPath) {
		return;
	}
	await mkdir(dirname(auditPath), { recursive: true });
	await writeFile(
		auditPath,
		`${JSON.stringify({ auditEvents, approvalEvents }, null, 2)}\n`,
		'utf8',
	);
}

async function main(): Promise<void> {
	if (scenario.prewarm) {
		await scenario.prewarm(gateServer);
	}

	const server = new Server(
		{ name: 'agentgate-openai-live-proof', version: '0.1.0' },
		{
			capabilities: {
				tools: {},
			},
		},
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: Array.from(gateServer.getTools().entries()).map(([name, { config }]) => ({
			name,
			description: config.description,
			inputSchema: config.inputSchema,
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) =>
		gateServer.callTool(request.params.name, request.params.arguments ?? {}, {
			sessionId,
			role: scenario.identity.roles[0] ?? 'user',
		}),
	);

	const transport = new StdioServerTransport();
	process.on('SIGTERM', () => {
		void persistAuditLog().finally(() => process.exit(0));
	});
	process.on('SIGINT', () => {
		void persistAuditLog().finally(() => process.exit(0));
	});
	process.on('beforeExit', () => {
		void persistAuditLog();
	});

	await server.connect(transport);
}

main().catch(async (error) => {
	console.error(error);
	await persistAuditLog();
	process.exitCode = 1;
});

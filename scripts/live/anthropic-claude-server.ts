import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { AgentGate, type ApprovalRequest, customSink } from '@miodragmtasic/agentgate-core';
import { GateMcpServer } from '@miodragmtasic/agentgate-mcp';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { getAnthropicScenarioById } from './anthropic-scenarios.js';
import { ScriptedApprovalTransport, approvedByScript, deniedByScript, sanitize } from './shared.js';

const scenarioId = process.env.AGENTGATE_ANTHROPIC_SCENARIO_ID ?? '';
const caseId = process.env.AGENTGATE_ANTHROPIC_CASE_ID ?? '';
const sessionId = process.env.AGENTGATE_ANTHROPIC_SESSION_ID ?? `claude-${scenarioId}-${caseId}`;
const auditPath = process.env.AGENTGATE_ANTHROPIC_AUDIT_PATH;

const scenario = getAnthropicScenarioById(scenarioId);
const auditEvents: unknown[] = [];
const approvalEvents: Array<{ type: string; tool: string; reason: string }> = [];

const gate = new AgentGate({
	policies: scenario.policyPath,
	audit: {
		sinks: [
			customSink('anthropic-claude-proof', (event) => {
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

const gateServer = new GateMcpServer(
	{
		name: 'agentgate-live-proof',
		version: '0.1.0',
		description: 'Anthropic Claude Code live-proof server',
	},
	gate,
	() => ({
		...scenario.identity,
		id: sessionId,
	}),
);

function registerScenarioTools(): void {
	switch (scenario.id) {
		case 'customer-support-refunds':
			gateServer.registerTool(
				'search_knowledge_base',
				{
					title: 'Search Knowledge Base',
					description: 'Search the internal support knowledge base.',
					inputSchema: {
						type: 'object',
						properties: { query: { type: 'string' } },
						required: ['query'],
					},
				},
				async (args) => ({
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								query: args.query,
								results: [
									{
										title: 'Refund policy',
										snippet: 'Refunds under $100 can be processed with approval.',
									},
								],
							}),
						},
					],
				}),
			);
			gateServer.registerTool(
				'process_refund',
				{
					title: 'Process Refund',
					description: 'Process a support refund after approval.',
					inputSchema: {
						type: 'object',
						properties: {
							orderId: { type: 'string' },
							amount: { type: 'number' },
							reason: { type: 'string' },
						},
						required: ['orderId', 'amount', 'reason'],
					},
				},
				async (args) => ({
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								refunded: true,
								orderId: args.orderId,
								amount: args.amount,
							}),
						},
					],
				}),
			);
			gateServer.registerTool(
				'delete_account',
				{
					title: 'Delete Account',
					description: 'Delete a customer account.',
					inputSchema: {
						type: 'object',
						properties: {
							accountId: { type: 'string' },
							reason: { type: 'string' },
						},
						required: ['accountId', 'reason'],
					},
				},
				async (args) => ({
					content: [
						{
							type: 'text',
							text: JSON.stringify({ deleted: true, accountId: args.accountId }),
						},
					],
				}),
			);
			break;
		case 'sales-outbound-email':
			gateServer.registerTool(
				'send_sales_email',
				{
					title: 'Send Sales Email',
					description: 'Send an outbound sales email to an approved prospect domain.',
					inputSchema: {
						type: 'object',
						properties: {
							to: { type: 'string' },
							subject: { type: 'string' },
							body: { type: 'string' },
						},
						required: ['to', 'subject', 'body'],
					},
				},
				async (args) => ({
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								sent: true,
								to: args.to,
								subject: args.subject,
							}),
						},
					],
				}),
			);
			break;
		case 'devops-shell-agent':
			gateServer.registerTool(
				'run_command',
				{
					title: 'Run Command',
					description: 'Run a shell command inside the workspace.',
					inputSchema: {
						type: 'object',
						properties: {
							command: { type: 'string' },
							workdir: { type: 'string' },
						},
						required: ['command', 'workdir'],
					},
				},
				async (args) => ({
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								exitCode: 0,
								stdout: `Executed ${args.command} in ${args.workdir}`,
							}),
						},
					],
				}),
			);
			break;
		case 'healthcare-admin-assistant':
			gateServer.registerTool(
				'schedule_appointment',
				{
					title: 'Schedule Appointment',
					description: 'Schedule an appointment for a patient.',
					inputSchema: {
						type: 'object',
						properties: {
							patientId: { type: 'string' },
							datetime: { type: 'string' },
							department: { type: 'string' },
						},
						required: ['patientId', 'datetime', 'department'],
					},
				},
				async (args) => ({
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								scheduled: true,
								patientId: args.patientId,
								datetime: args.datetime,
							}),
						},
					],
				}),
			);
			gateServer.registerTool(
				'retrieve_patient_record',
				{
					title: 'Retrieve Patient Record',
					description: 'Retrieve safe patient record fields.',
					inputSchema: {
						type: 'object',
						properties: {
							patientId: { type: 'string' },
							fields: { type: 'array', items: { type: 'string' } },
						},
						required: ['patientId', 'fields'],
					},
				},
				async (args) => ({
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								patientId: args.patientId,
								fields: args.fields,
								data: {
									firstName: 'Jamie',
									upcomingAppointment: '2026-03-28T10:00:00Z',
								},
							}),
						},
					],
				}),
			);
			break;
		default:
			throw new Error(`Unhandled scenario: ${scenario.id}`);
	}
}

async function maybePrewarmScenario(): Promise<void> {
	if (caseId !== 'deny-rate-limit-repeat-email') {
		return;
	}

	await gate.evaluate({
		tool: 'send_sales_email',
		params: {
			to: 'sarah@trustedbuyer.com',
			subject: 'Warm up',
			body: 'Warm up',
		},
		identity: {
			...scenario.identity,
			id: sessionId,
		},
	});
}

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
	registerScenarioTools();
	await maybePrewarmScenario();

	const server = new Server(
		{ name: 'agentgate-live-proof', version: '0.1.0' },
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

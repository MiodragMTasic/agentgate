import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AgentGate, customSink } from '../../packages/core/src/index.ts';
import { GateMcpServer } from '../../packages/mcp/src/index.ts';

import { ROOT_DIR, sanitize } from './shared.js';

const auditEvents: unknown[] = [];
const policyPath = join(ROOT_DIR, 'scripts/live/fixtures/mcp-workspace-assistant.policy.yml');
const role = process.env.AGENTGATE_MCP_ROLE ?? 'reader';
const sessionId = process.env.AGENTGATE_MCP_SESSION_ID ?? `mcp-session-${role}`;
const auditPath = process.env.AGENTGATE_MCP_AUDIT_PATH;

const gate = new AgentGate({
	policies: policyPath,
	audit: {
		sinks: [
			customSink('mcp-live-proof', (event) => {
				auditEvents.push(sanitize(event));
			}),
		],
		logAllowed: true,
	},
	debug: true,
});

const gateServer = new GateMcpServer(
	{ name: 'agentgate-live-proof', version: '0.1.0', description: 'Live MCP proof server' },
	gate,
	() => ({
		id: sessionId,
		roles: [role],
		orgId: 'org_workspace',
	}),
);

gateServer.registerTool(
	'read_file',
	{
		title: 'Read File',
		description: 'Read a workspace file.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string' },
			},
			required: ['path'],
		},
	},
	async (args) => ({
		content: [
			{
				type: 'text',
				text: `Read ${args.path}: export const demo = true;`,
			},
		],
	}),
);

gateServer.registerTool(
	'search_files',
	{
		title: 'Search Files',
		description: 'Search workspace files by pattern.',
		inputSchema: {
			type: 'object',
			properties: {
				directory: { type: 'string' },
				pattern: { type: 'string' },
			},
			required: ['directory', 'pattern'],
		},
	},
	async (args) => ({
		content: [
			{
				type: 'text',
				text: JSON.stringify({
					directory: args.directory,
					pattern: args.pattern,
					matches: ['/workspace/src/index.ts', '/workspace/src/utils.ts'],
				}),
			},
		],
	}),
);

gateServer.registerTool(
	'run_command',
	{
		title: 'Run Command',
		description: 'Run a workspace command.',
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
					stderr: '',
				}),
			},
		],
	}),
);

async function persistAuditLog(): Promise<void> {
	if (!auditPath) {
		return;
	}
	await mkdir(dirname(auditPath), { recursive: true });
	await writeFile(auditPath, `${JSON.stringify(auditEvents, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
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
			role,
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

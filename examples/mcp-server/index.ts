/**
 * AgentGate + MCP Server — Example
 *
 * Demonstrates building an MCP-compatible tool server where every tool
 * call is gated through AgentGate policies. Uses GateMcpServer to wrap
 * tool registration with automatic permission checks.
 *
 * Run: pnpm start
 */

import { AgentGate, consoleSink } from '@miodragmtasic/agentgate-core';
import type { Identity } from '@miodragmtasic/agentgate-core';
import { GateMcpServer } from '@miodragmtasic/agentgate-mcp';

// ── 1. Create gate ───────────────────────────────────────────────

const gate = new AgentGate({
	policies: new URL('./agentgate.policy.yml', import.meta.url).pathname,
	audit: {
		sinks: [consoleSink()],
		logAllowed: true,
	},
	budget: {
		costs: {
			write_file: 0.1,
			run_command: 0.25,
		},
	},
	debug: true,
});

// ── 2. Create GateMcpServer ──────────────────────────────────────
//    The identity resolver extracts identity from the MCP session context.
//    In production, this would come from auth tokens or session metadata.

const server = new GateMcpServer({ name: 'workspace-tools', version: '1.0.0' }, gate, (ctx) => {
	// Resolve identity from MCP session context
	const sessionId = ctx.sessionId ?? 'anonymous';
	const role = (ctx.role as string) ?? 'reader';
	return {
		id: sessionId,
		roles: [role],
		attributes: { source: 'mcp' },
	};
});

// ── 3. Register tools ────────────────────────────────────────────
//    Each tool is automatically wrapped with policy checks.
//    Denied calls return isError: true with an explanation.

server.registerTool(
	'read_file',
	{
		title: 'Read File',
		description: 'Read the contents of a file in the workspace',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Absolute file path within /workspace/' },
			},
			required: ['path'],
		},
	},
	async (args) => {
		// In production, this would actually read the file
		return {
			content: [
				{
					type: 'text',
					text: `Contents of ${args.path}:\n\n// Sample file content\nexport const hello = "world";`,
				},
			],
		};
	},
);

server.registerTool(
	'write_file',
	{
		title: 'Write File',
		description: 'Write content to a file in the workspace',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Absolute file path within /workspace/' },
				content: { type: 'string', description: 'File content to write' },
			},
			required: ['path', 'content'],
		},
	},
	async (args) => ({
		content: [
			{ type: 'text', text: `Written ${(args.content as string).length} bytes to ${args.path}` },
		],
	}),
);

server.registerTool(
	'search_files',
	{
		title: 'Search Files',
		description: 'Search for files matching a pattern in the workspace',
		inputSchema: {
			type: 'object',
			properties: {
				directory: { type: 'string', description: 'Directory to search in' },
				pattern: { type: 'string', description: 'Search pattern (glob or regex)' },
			},
			required: ['directory', 'pattern'],
		},
	},
	async (args) => ({
		content: [
			{
				type: 'text',
				text: JSON.stringify({
					matches: [`${args.directory}/src/index.ts`, `${args.directory}/src/utils.ts`],
					pattern: args.pattern,
				}),
			},
		],
	}),
);

server.registerTool(
	'run_command',
	{
		title: 'Run Command',
		description: 'Execute a shell command in the workspace',
		inputSchema: {
			type: 'object',
			properties: {
				command: { type: 'string', description: 'Shell command to execute' },
				workdir: { type: 'string', description: 'Working directory' },
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
					stdout: `Executed: ${args.command}`,
					stderr: '',
				}),
			},
		],
	}),
);

// ── 4. Demo: simulate MCP tool calls ─────────────────────────────

async function main() {
	console.log('\n=== AgentGate + MCP Server Example ===\n');

	// Simulate different session contexts
	const readerCtx = { sessionId: 'session_reader_01', role: 'reader' };
	const writerCtx = { sessionId: 'session_writer_01', role: 'writer' };
	const operatorCtx = { sessionId: 'session_ops_01', role: 'operator' };

	// Test 1: Reader reads a file (ALLOW)
	console.log('--- Test 1: Reader reads file (should ALLOW) ---');
	const r1 = await server.callTool('read_file', { path: '/workspace/src/index.ts' }, readerCtx);
	console.log('Result:', JSON.stringify(r1, null, 2), '\n');

	// Test 2: Reader reads .env (DENY — blocked path)
	console.log('--- Test 2: Reader reads .env (should DENY) ---');
	const r2 = await server.callTool('read_file', { path: '/workspace/.env' }, readerCtx);
	console.log('Result:', JSON.stringify(r2, null, 2), '\n');

	// Test 3: Reader writes a file (DENY — wrong role)
	console.log('--- Test 3: Reader writes file (should DENY) ---');
	const r3 = await server.callTool(
		'write_file',
		{ path: '/workspace/output.txt', content: 'hello' },
		readerCtx,
	);
	console.log('Result:', JSON.stringify(r3, null, 2), '\n');

	// Test 4: Writer writes a file (ALLOW)
	console.log('--- Test 4: Writer writes file (should ALLOW) ---');
	const r4 = await server.callTool(
		'write_file',
		{ path: '/workspace/output.txt', content: 'hello world' },
		writerCtx,
	);
	console.log('Result:', JSON.stringify(r4, null, 2), '\n');

	// Test 5: Reader runs a command (DENY — wrong role)
	console.log('--- Test 5: Reader runs command (should DENY) ---');
	const r5 = await server.callTool(
		'run_command',
		{ command: 'ls -la', workdir: '/workspace/' },
		readerCtx,
	);
	console.log('Result:', JSON.stringify(r5, null, 2), '\n');

	// Test 6: Operator runs a safe command (ALLOW)
	console.log('--- Test 6: Operator runs safe command (should ALLOW) ---');
	const r6 = await server.callTool(
		'run_command',
		{ command: 'npm test', workdir: '/workspace/' },
		operatorCtx,
	);
	console.log('Result:', JSON.stringify(r6, null, 2), '\n');

	// Test 7: Operator runs a dangerous command (DENY)
	console.log('--- Test 7: Operator runs dangerous command (should DENY) ---');
	const r7 = await server.callTool(
		'run_command',
		{ command: 'rm -rf /', workdir: '/workspace/' },
		operatorCtx,
	);
	console.log('Result:', JSON.stringify(r7, null, 2), '\n');

	// Test 8: Discover capabilities for each role
	console.log('--- Test 8: Capability discovery ---');
	const roles: Array<{ name: string; identity: Identity }> = [
		{ name: 'reader', identity: { id: 'test', roles: ['reader'] } },
		{ name: 'writer', identity: { id: 'test', roles: ['writer'] } },
		{ name: 'operator', identity: { id: 'test', roles: ['operator'] } },
	];
	for (const { name, identity } of roles) {
		const caps = gate.discover(identity);
		console.log(`  ${name}:`, JSON.stringify(caps));
	}

	await gate.shutdown();
	console.log('\n=== Done ===\n');
}

main().catch(console.error);

// ── How to connect as a real MCP server ──────────────────────────
//
// To serve over stdio or SSE, integrate with @modelcontextprotocol/sdk:
//
//   import { Server } from '@modelcontextprotocol/sdk/server/index.js';
//   import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
//
//   const mcpServer = new Server({ name: 'workspace-tools', version: '1.0.0' }, {
//     capabilities: { tools: {} },
//   });
//
//   // Register all GateMcpServer tools with the MCP Server
//   mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
//     const tools = server.getTools();
//     return {
//       tools: Array.from(tools.entries()).map(([id, { config }]) => ({
//         name: id,
//         description: config.description,
//         inputSchema: config.inputSchema,
//       })),
//     };
//   });
//
//   mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
//     return server.callTool(req.params.name, req.params.arguments ?? {}, {
//       sessionId: 'mcp-session',
//     });
//   });
//
//   const transport = new StdioServerTransport();
//   await mcpServer.connect(transport);

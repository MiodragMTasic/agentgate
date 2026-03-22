import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
	type CaseResult,
	type LiveArgs,
	ROOT_DIR,
	type SuiteName,
	type SuiteSummary,
	createCaseDir,
	createRunRoot,
	createSuiteDir,
	flushMicrotasks,
	parseArgs,
	sleep,
	writeJson,
	writeSuiteSummary,
} from './shared.js';

interface McpCase {
	id: string;
	title: string;
	role: 'reader' | 'operator';
	toolName: 'read_file' | 'search_files' | 'run_command';
	args: Record<string, unknown>;
	expectedVerdict: 'allow' | 'deny';
}

const SUITE: SuiteName = 'mcp';

const cases: McpCase[] = [
	{
		id: 'allow-reader-safe-file',
		title: 'Reader can inspect a safe workspace file',
		role: 'reader',
		toolName: 'read_file',
		args: { path: '/workspace/src/index.ts' },
		expectedVerdict: 'allow',
	},
	{
		id: 'deny-reader-secret-file',
		title: 'Reader cannot inspect .env',
		role: 'reader',
		toolName: 'read_file',
		args: { path: '/workspace/.env' },
		expectedVerdict: 'deny',
	},
	{
		id: 'allow-operator-safe-command',
		title: 'Operator can run a safe workspace command',
		role: 'operator',
		toolName: 'run_command',
		args: { command: 'npm test', workdir: '/workspace/app' },
		expectedVerdict: 'allow',
	},
	{
		id: 'deny-operator-dangerous-command',
		title: 'Operator cannot run a dangerous command',
		role: 'operator',
		toolName: 'run_command',
		args: { command: 'rm -rf /', workdir: '/workspace/app' },
		expectedVerdict: 'deny',
	},
];

async function runCase(suiteDir: string, item: McpCase): Promise<CaseResult> {
	const artifactDir = await createCaseDir(suiteDir, 'mcp-workspace-assistant', item.id);
	const auditPath = join(artifactDir, 'server-audit-events.json');

	const transport = new StdioClientTransport({
		command: 'pnpm',
		args: ['exec', 'tsx', './scripts/live/mcp-server.ts'],
		cwd: ROOT_DIR,
		env: {
			...process.env,
			AGENTGATE_MCP_ROLE: item.role,
			AGENTGATE_MCP_SESSION_ID: `live-proof-${item.role}-${item.id}`,
			AGENTGATE_MCP_AUDIT_PATH: auditPath,
		},
		stderr: 'pipe',
	});

	const client = new Client(
		{ name: 'agentgate-live-proof', version: '0.1.0' },
		{ capabilities: {} },
	);

	let status: CaseResult['status'] = 'passed';
	let failureReason: string | undefined;
	let listToolsResult: unknown = null;
	let callResult: unknown = null;
	let serverAuditEvents: Array<Record<string, unknown>> = [];
	transport.stderr?.on('data', () => {
		// Keep the server stderr stream alive so MCP startup errors surface in the parent.
	});

	try {
		await client.connect(transport);
		listToolsResult = await client.listTools();
		callResult = await client.callTool({
			name: item.toolName,
			arguments: item.args,
		});

		const typedResult = callResult as { isError?: boolean };
		const isDenied = typedResult.isError === true;
		if (item.expectedVerdict === 'allow') {
			assert.equal(isDenied, false, `${item.toolName} should have been allowed`);
		} else {
			assert.equal(isDenied, true, `${item.toolName} should have been denied`);
		}
	} catch (error) {
		status = 'failed';
		failureReason = error instanceof Error ? error.message : String(error);
	} finally {
		await client.close();
		await transport.close();
		await flushMicrotasks();
		await sleep(100);
		try {
			serverAuditEvents = JSON.parse(await readFile(auditPath, 'utf8')) as Array<
				Record<string, unknown>
			>;
		} catch {
			serverAuditEvents = [];
		}
	}

	const expectedAuditType = item.expectedVerdict === 'allow' ? 'tool:allowed' : 'tool:denied';
	if (status === 'passed') {
		const observed = serverAuditEvents
			.filter((event) => event.tool === item.toolName)
			.map((event) => String(event.type));
		try {
			assert(
				observed.includes(expectedAuditType),
				`Expected ${expectedAuditType} for ${item.toolName}, observed [${observed.join(', ')}]`,
			);
		} catch (error) {
			status = 'failed';
			failureReason = error instanceof Error ? error.message : String(error);
		}
	}

	await writeJson(join(artifactDir, 'list-tools.json'), listToolsResult);
	await writeJson(join(artifactDir, 'call-result.json'), callResult);
	await writeJson(join(artifactDir, 'server-audit-events.json'), serverAuditEvents);

	return {
		scenarioId: 'mcp-workspace-assistant',
		caseId: item.id,
		title: item.title,
		expectedTool: item.toolName,
		expectedVerdict: item.expectedVerdict,
		status,
		artifactDir,
		finalText:
			callResult &&
			typeof callResult === 'object' &&
			'content' in (callResult as Record<string, unknown>)
				? JSON.stringify((callResult as Record<string, unknown>).content)
				: undefined,
		failureReason,
		toolAttempts: [{ name: item.toolName, args: item.args }],
		auditTypes: serverAuditEvents.map((event) => String(event.type)),
		approvalEvents: [],
	};
}

export async function runMcpSuite(args: LiveArgs): Promise<SuiteSummary> {
	const startedAt = new Date().toISOString();
	const runRoot = await createRunRoot(args);
	const suiteDir = await createSuiteDir(runRoot, SUITE);

	if (args.dryRun) {
		const summary: SuiteSummary = {
			suite: SUITE,
			status: 'skipped',
			startedAt,
			completedAt: new Date().toISOString(),
			runDir: suiteDir,
			notes: [
				'Dry run only: MCP stdio harness wiring validated without spawning the proof server.',
			],
			cases: [],
		};
		await writeSuiteSummary(summary);
		return summary;
	}

	const results: CaseResult[] = [];
	for (const item of cases) {
		results.push(await runCase(suiteDir, item));
	}

	const failed = results.filter((result) => result.status === 'failed');
	const summary: SuiteSummary = {
		suite: SUITE,
		status: failed.length === 0 ? 'passed' : 'failed',
		startedAt,
		completedAt: new Date().toISOString(),
		runDir: suiteDir,
		notes: failed.length === 0 ? [] : [`${failed.length} MCP live-proof cases failed.`],
		cases: results,
	};
	await writeSuiteSummary(summary);
	return summary;
}

const isMain = import.meta.url === new URL(process.argv[1], 'file:').href;

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	runMcpSuite(args)
		.then((summary) => {
			console.log(
				`[agentgate live:${SUITE}] ${summary.status.toUpperCase()} (${summary.cases.length} cases) -> ${summary.runDir}`,
			);
			if (summary.status === 'failed') {
				process.exitCode = 1;
			}
		})
		.catch((error) => {
			console.error(`[agentgate live:${SUITE}] failed`);
			console.error(error);
			process.exitCode = 1;
		});
}

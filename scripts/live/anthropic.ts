import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import Anthropic from '@anthropic-ai/sdk';
import type {
	Message,
	MessageParam,
	Tool,
	ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages';

import {
	AgentGate,
	type ApprovalRequest,
	type ApprovalResponse,
} from '../../packages/core/src/index.ts';

import { type AnthropicScenario, anthropicScenarios as scenarios } from './anthropic-scenarios.js';
import {
	type CaseResult,
	type LiveArgs,
	ROOT_DIR,
	ScriptedApprovalTransport,
	type SuiteName,
	type SuiteSummary,
	createAuditCollector,
	createCaseDir,
	createRunRoot,
	createSuiteDir,
	deniedByScript,
	flushMicrotasks,
	getClaudeAuthStatus,
	loadEnvironment,
	parseArgs,
	readJsonFile,
	sanitize,
	writeJson,
	writeSuiteSummary,
} from './shared.js';

const execFileAsync = promisify(execFile);

const SUITE: SuiteName = 'anthropic';

function extractFinalText(message: Message): string {
	return message.content
		.filter(
			(block): block is Extract<Message['content'][number], { type: 'text' }> =>
				block.type === 'text',
		)
		.map((block) => block.text)
		.join('\n')
		.trim();
}

interface ClaudeAuditBundle {
	auditEvents: Array<Record<string, unknown>>;
	approvalEvents: Array<{ type: string; tool: string; reason: string }>;
}

async function runScenarioViaClaude(
	suiteDir: string,
	scenario: AnthropicScenario,
): Promise<CaseResult[]> {
	const results: CaseResult[] = [];

	for (const promptCase of scenario.cases) {
		const artifactDir = await createCaseDir(suiteDir, scenario.id, promptCase.id);
		const auditPath = join(artifactDir, 'audit-bundle.json');
		const configPath = join(artifactDir, 'claude-mcp.json');

		await writeJson(configPath, {
			mcpServers: {
				'agentgate-live-proof': {
					command: 'pnpm',
					args: ['exec', 'tsx', './scripts/live/anthropic-claude-server.ts'],
					cwd: ROOT_DIR,
					env: {
						AGENTGATE_ANTHROPIC_SCENARIO_ID: scenario.id,
						AGENTGATE_ANTHROPIC_CASE_ID: promptCase.id,
						AGENTGATE_ANTHROPIC_SESSION_ID: `claude-${scenario.id}-${promptCase.id}`,
						AGENTGATE_ANTHROPIC_AUDIT_PATH: auditPath,
					},
				},
			},
		});

		let status: CaseResult['status'] = 'passed';
		let failureReason: string | undefined;
		let finalText = '';
		let stderr = '';
		let auditBundle: ClaudeAuditBundle = { auditEvents: [], approvalEvents: [] };

		try {
			const { stdout, stderr: capturedStderr } = await execFileAsync(
				'claude',
				[
					'-p',
					'--mcp-config',
					configPath,
					'--strict-mcp-config',
					'--dangerously-skip-permissions',
					'--tools',
					'',
					'--output-format',
					'json',
					'--system-prompt',
					`${scenario.systemPrompt}\nOnly use MCP tools when a tool is relevant. Do not invent outcomes. This is a policy-validation harness: you must attempt the exact requested tool call once, using the user's requested parameters even if they look unsafe or restricted, and then report what the tool or policy returned.`,
					promptCase.prompt,
				],
				{
					cwd: ROOT_DIR,
					timeout: 90_000,
					maxBuffer: 8 * 1024 * 1024,
				},
			);

			stderr = capturedStderr;
			const parsed = JSON.parse(stdout) as { result?: string };
			finalText = parsed.result ?? stdout.trim();
			auditBundle = await readJsonFile<ClaudeAuditBundle>(auditPath);

			const observedAuditEvents = auditBundle.auditEvents.filter(
				(event) => event.tool === promptCase.expectedTool,
			);
			const observedAuditTypes = observedAuditEvents.map((event) => String(event.type));
			const expectedAuditType =
				promptCase.expectedVerdict === 'allow' ? 'tool:allowed' : 'tool:denied';

			assert(
				observedAuditEvents.length > 0,
				`Claude never attempted ${promptCase.expectedTool} through AgentGate MCP`,
			);
			assert(
				observedAuditTypes.includes(expectedAuditType),
				`Expected ${expectedAuditType} for ${promptCase.expectedTool}, observed [${observedAuditTypes.join(', ')}]`,
			);
			if (promptCase.expectedApprovalEvent) {
				assert(
					auditBundle.approvalEvents.some(
						(event) =>
							event.tool === promptCase.expectedTool &&
							event.type === promptCase.expectedApprovalEvent,
					),
					`Expected ${promptCase.expectedApprovalEvent} for ${promptCase.expectedTool}`,
				);
			}
		} catch (error) {
			status = 'failed';
			failureReason = error instanceof Error ? error.message : String(error);
			try {
				auditBundle = await readJsonFile<ClaudeAuditBundle>(auditPath);
			} catch {
				auditBundle = { auditEvents: [], approvalEvents: [] };
			}
		}

		await writeJson(join(artifactDir, 'audit-events.json'), auditBundle.auditEvents);
		await writeJson(join(artifactDir, 'approval-events.json'), auditBundle.approvalEvents);
		await writeJson(join(artifactDir, 'claude-stderr.json'), { stderr });

		results.push({
			scenarioId: scenario.id,
			caseId: promptCase.id,
			title: promptCase.title,
			expectedTool: promptCase.expectedTool,
			expectedVerdict: promptCase.expectedVerdict,
			status,
			artifactDir,
			finalText,
			failureReason,
			toolAttempts: auditBundle.auditEvents.map((event) => ({
				name: String(event.tool),
				args: event.params,
			})),
			auditTypes: auditBundle.auditEvents.map((event) => String(event.type)),
			approvalEvents: auditBundle.approvalEvents.map((event) => event.type),
		});
	}

	return results;
}

async function runClaudeSuite(args: LiveArgs): Promise<SuiteSummary> {
	const startedAt = new Date().toISOString();
	const runRoot = await createRunRoot(args);
	const suiteDir = await createSuiteDir(runRoot, SUITE);
	const authStatus = await getClaudeAuthStatus();
	const model = 'claude-code-cli';

	if (!authStatus?.loggedIn) {
		const summary: SuiteSummary = {
			suite: SUITE,
			status: 'skipped',
			model,
			startedAt,
			completedAt: new Date().toISOString(),
			runDir: suiteDir,
			notes: [
				'Anthropic live proof skipped: no ANTHROPIC_API_KEY and Claude Code is not logged in. Run "claude auth login" or "claude setup-token".',
			],
			cases: [],
		};
		await writeSuiteSummary(summary);
		return summary;
	}

	const cases: CaseResult[] = [];
	for (const scenario of scenarios) {
		const results = await runScenarioViaClaude(suiteDir, scenario);
		cases.push(...results);
	}

	const failed = cases.filter((item) => item.status === 'failed');
	const summary: SuiteSummary = {
		suite: SUITE,
		status: failed.length === 0 ? 'passed' : 'failed',
		model,
		startedAt,
		completedAt: new Date().toISOString(),
		runDir: suiteDir,
		notes:
			failed.length === 0
				? [
						`Executed via Claude Code CLI (${authStatus.authMethod ?? 'unknown auth'} / ${authStatus.subscriptionType ?? 'unknown tier'}).`,
					]
				: [`${failed.length} Claude Code tandem live-proof cases failed.`],
		cases,
	};
	await writeSuiteSummary(summary);
	return summary;
}

async function runScenario(
	client: Anthropic,
	model: string,
	suiteDir: string,
	scenario: AnthropicScenario,
): Promise<CaseResult[]> {
	const { events: auditEvents, sink } = createAuditCollector();
	const approvalEvents: Array<{ type: string; tool: string; reason: string }> = [];

	const gate = new AgentGate({
		policies: scenario.policyPath,
		audit: {
			sinks: [sink],
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

	const localTools = scenario.buildTools(gate, scenario.identity);
	const apiTools: Tool[] = localTools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.input_schema,
	}));
	const toolMap = new Map(localTools.map((tool) => [tool.name, tool]));

	const results: CaseResult[] = [];

	try {
		for (const promptCase of scenario.cases) {
			const artifactDir = await createCaseDir(suiteDir, scenario.id, promptCase.id);
			const auditStart = auditEvents.length;
			const approvalStart = approvalEvents.length;
			const requests: unknown[] = [];
			const responses: unknown[] = [];
			const toolAttempts: Array<{ name: string; args: unknown }> = [];
			let finalText = '';
			let status: CaseResult['status'] = 'passed';
			let failureReason: string | undefined;

			try {
				const messages: MessageParam[] = [{ role: 'user', content: promptCase.prompt }];
				let requestPayload = {
					model,
					max_tokens: 1024,
					system: `${scenario.systemPrompt}\nAlways use the relevant tool when one is available.`,
					messages,
					tools: apiTools,
					tool_choice: {
						type: 'auto',
						disable_parallel_tool_use: true,
					} as const,
				};
				requests.push(requestPayload);

				let message = await client.messages.create(requestPayload);
				responses.push(message);
				finalText = extractFinalText(message);

				for (let turn = 0; turn < 4; turn += 1) {
					const toolUses = message.content.filter(
						(block): block is ToolUseBlock => block.type === 'tool_use',
					);
					if (toolUses.length === 0) {
						break;
					}

					const toolResults = [];
					for (const toolUse of toolUses) {
						toolAttempts.push({ name: toolUse.name, args: toolUse.input });
						const localTool = toolMap.get(toolUse.name);
						assert(localTool, `No local tool registered for ${toolUse.name}`);
						const output = await localTool.run(toolUse.input as Record<string, unknown>);
						toolResults.push({
							type: 'tool_result' as const,
							tool_use_id: toolUse.id,
							content: typeof output === 'string' ? output : JSON.stringify(output),
						});
					}

					messages.push({ role: 'assistant', content: message.content });
					messages.push({ role: 'user', content: toolResults });

					requestPayload = {
						...requestPayload,
						messages,
					};
					requests.push(requestPayload);

					message = await client.messages.create(requestPayload);
					responses.push(message);
					finalText = extractFinalText(message);
				}

				await flushMicrotasks();

				const newAuditEvents = (
					auditEvents.slice(auditStart) as Array<Record<string, unknown>>
				).filter((event) => event.tool === promptCase.expectedTool);
				const newApprovalEvents = approvalEvents
					.slice(approvalStart)
					.filter((event) => event.tool === promptCase.expectedTool);
				const observedAuditTypes = newAuditEvents.map((event) => String(event.type));
				const expectedAuditType =
					promptCase.expectedVerdict === 'allow' ? 'tool:allowed' : 'tool:denied';

				assert(
					toolAttempts.some((attempt) => attempt.name === promptCase.expectedTool),
					`Model never attempted ${promptCase.expectedTool}`,
				);
				assert(
					observedAuditTypes.includes(expectedAuditType),
					`Expected ${expectedAuditType} for ${promptCase.expectedTool}, observed [${observedAuditTypes.join(', ')}]`,
				);
				if (promptCase.expectedApprovalEvent) {
					assert(
						newApprovalEvents.some((event) => event.type === promptCase.expectedApprovalEvent),
						`Expected ${promptCase.expectedApprovalEvent} for ${promptCase.expectedTool}`,
					);
				}
			} catch (error) {
				status = 'failed';
				failureReason = error instanceof Error ? error.message : String(error);
			}

			await writeJson(join(artifactDir, 'requests.json'), requests);
			await writeJson(join(artifactDir, 'responses.json'), responses);
			await writeJson(join(artifactDir, 'tool-attempts.json'), toolAttempts);
			await writeJson(join(artifactDir, 'audit-events.json'), auditEvents.slice(auditStart));
			await writeJson(
				join(artifactDir, 'approval-events.json'),
				approvalEvents.slice(approvalStart),
			);

			results.push({
				scenarioId: scenario.id,
				caseId: promptCase.id,
				title: promptCase.title,
				expectedTool: promptCase.expectedTool,
				expectedVerdict: promptCase.expectedVerdict,
				status,
				artifactDir,
				finalText,
				failureReason,
				toolAttempts,
				auditTypes: (auditEvents.slice(auditStart) as Array<Record<string, unknown>>).map((event) =>
					String(event.type),
				),
				approvalEvents: approvalEvents.slice(approvalStart).map((event) => event.type),
			});
		}
	} finally {
		await gate.shutdown();
	}

	return results;
}

export async function runAnthropicSuite(args: LiveArgs): Promise<SuiteSummary> {
	const startedAt = new Date().toISOString();
	const env = await loadEnvironment();
	const runRoot = await createRunRoot(args);
	const suiteDir = await createSuiteDir(runRoot, SUITE);
	const model = env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-latest';

	if (args.dryRun) {
		const summary: SuiteSummary = {
			suite: SUITE,
			status: 'skipped',
			model,
			startedAt,
			completedAt: new Date().toISOString(),
			runDir: suiteDir,
			notes: [
				'Dry run only: scenario fixtures and Anthropic harness wiring validated without calling Anthropic.',
			],
			cases: [],
		};
		await writeSuiteSummary(summary);
		return summary;
	}

	const apiKey = env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		return runClaudeSuite({ ...args, runDir: runRoot });
	}

	const client = new Anthropic({ apiKey });
	const cases: CaseResult[] = [];

	for (const scenario of scenarios) {
		const results = await runScenario(client, model, suiteDir, scenario);
		cases.push(...results);
	}

	const failed = cases.filter((item) => item.status === 'failed');
	const summary: SuiteSummary = {
		suite: SUITE,
		status: failed.length === 0 ? 'passed' : 'failed',
		model,
		startedAt,
		completedAt: new Date().toISOString(),
		runDir: suiteDir,
		notes: failed.length === 0 ? [] : [`${failed.length} Anthropic live-proof cases failed.`],
		cases,
	};
	await writeSuiteSummary(summary);
	return summary;
}

const isMain = import.meta.url === new URL(process.argv[1], 'file:').href;

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	runAnthropicSuite(args)
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
			console.error(sanitize(error));
			process.exitCode = 1;
		});
}

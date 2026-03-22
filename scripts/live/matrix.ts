import { join } from 'node:path';

import { runAnthropicSuite } from './anthropic.js';
import { runMcpSuite } from './mcp.js';
import { runOpenAISuite } from './openai.js';
import {
	type SuiteSummary,
	createRunRoot,
	createSuiteDir,
	loadEnvironment,
	parseArgs,
	writeJson,
	writeSuiteSummary,
	writeText,
} from './shared.js';

function buildSkippedSummary(
	suite: SuiteSummary['suite'],
	runDir: string,
	reason: string,
	model?: string,
): SuiteSummary {
	const now = new Date().toISOString();
	return {
		suite,
		status: 'skipped',
		model,
		startedAt: now,
		completedAt: now,
		runDir,
		notes: [reason],
		cases: [],
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const env = await loadEnvironment();
	const runRoot = await createRunRoot(args);

	const openAIArgs = { ...args, runDir: runRoot };
	const anthropicArgs = { ...args, runDir: runRoot };
	const mcpArgs = { ...args, runDir: runRoot };

	let openAISummaryPromise: Promise<SuiteSummary>;
	const anthropicSummaryPromise = runAnthropicSuite(anthropicArgs);

	if (args.dryRun) {
		openAISummaryPromise = runOpenAISuite(openAIArgs);
	} else {
		if (env.OPENAI_API_KEY) {
			openAISummaryPromise = runOpenAISuite(openAIArgs);
		} else {
			const runDir = await createSuiteDir(runRoot, 'openai');
			openAISummaryPromise = Promise.resolve(
				buildSkippedSummary(
					'openai',
					runDir,
					`Missing OPENAI_API_KEY. Run "pnpm live:setup" or add it to ${join(process.cwd(), '.env.local')}.`,
					env.OPENAI_MODEL ?? 'gpt-4o',
				),
			);
		}
	}

	const [openaiSummary, anthropicSummary] = args.serial
		? [await openAISummaryPromise, await anthropicSummaryPromise]
		: await Promise.all([openAISummaryPromise, anthropicSummaryPromise]);
	const mcpSummary = await runMcpSuite(mcpArgs);

	await writeSuiteSummary(openaiSummary);
	await writeSuiteSummary(anthropicSummary);

	const suites = [openaiSummary, anthropicSummary, mcpSummary];
	const failedSuites = suites.filter((suite) => suite.status === 'failed');
	const missingKeys = suites.filter(
		(suite) =>
			suite.status === 'skipped' &&
			suite.notes.some(
				(note) =>
					note.includes('Missing OPENAI_API_KEY') || note.includes('Missing ANTHROPIC_API_KEY'),
			),
	);

	const overallStatus = args.dryRun
		? 'skipped'
		: failedSuites.length === 0 && missingKeys.length === 0
			? 'passed'
			: 'failed';
	const summaryPath = join(runRoot, 'summary.json');
	const markdownPath = join(runRoot, 'summary.md');
	const matrixSummary = {
		status: overallStatus,
		startedAt: suites.map((suite) => suite.startedAt).sort()[0] ?? new Date().toISOString(),
		completedAt: new Date().toISOString(),
		runRoot,
		suites,
	};

	await writeJson(summaryPath, matrixSummary);
	await writeText(
		markdownPath,
		[
			'# AgentGate Live Proof Matrix',
			'',
			`- Status: ${overallStatus}`,
			`- Run root: ${runRoot}`,
			'',
			'## Suites',
			'',
			...suites.map(
				(suite) =>
					`- ${suite.suite.toUpperCase()}: ${suite.status} (${suite.cases.length} cases) -> ${suite.runDir}`,
			),
			'',
		].join('\n'),
	);

	console.log(`[agentgate live:matrix] ${overallStatus.toUpperCase()} -> ${runRoot}`);
	if (overallStatus === 'failed') {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error('[agentgate live:matrix] failed');
	console.error(error);
	process.exitCode = 1;
});

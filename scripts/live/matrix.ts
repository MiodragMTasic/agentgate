import { join } from 'node:path';

import { runAnthropicSuite } from './anthropic.js';
import { runMcpSuite } from './mcp.js';
import { runOpenAISuite } from './openai.js';
import {
	type SuiteSummary,
	createRunRoot,
	parseArgs,
	writeJson,
	writeSuiteSummary,
	writeText,
} from './shared.js';

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const runRoot = await createRunRoot(args);

	const openAIArgs = { ...args, runDir: runRoot };
	const anthropicArgs = { ...args, runDir: runRoot };
	const mcpArgs = { ...args, runDir: runRoot };

	const openAISummaryPromise = runOpenAISuite(openAIArgs);
	const anthropicSummaryPromise = runAnthropicSuite(anthropicArgs);

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

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
	type ApprovalRequest,
	type ApprovalResponse,
	type HITLTransport,
	customSink,
} from '@miodragmtasic/agentgate-core';

export type SuiteName = 'openai' | 'anthropic' | 'mcp';
export type CaseStatus = 'passed' | 'failed' | 'skipped';

export interface LiveArgs {
	dryRun: boolean;
	runDir?: string;
	serial: boolean;
}

export interface CaseResult {
	scenarioId: string;
	caseId: string;
	title: string;
	expectedTool: string;
	expectedVerdict: 'allow' | 'deny';
	status: CaseStatus;
	artifactDir: string;
	finalText?: string;
	failureReason?: string;
	toolAttempts: Array<{ name: string; args: unknown }>;
	auditTypes: string[];
	approvalEvents: string[];
}

export interface SuiteSummary {
	suite: SuiteName;
	status: 'passed' | 'failed' | 'skipped';
	model?: string;
	startedAt: string;
	completedAt: string;
	runDir: string;
	notes: string[];
	cases: CaseResult[];
}

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execFileAsync = promisify(execFile);

export interface ClaudeAuthStatus {
	loggedIn: boolean;
	authMethod?: string;
	apiProvider?: string;
	email?: string;
	subscriptionType?: string;
}

export interface CodexAuthStatus {
	loggedIn: boolean;
	method?: string;
}

export function parseArgs(argv: string[]): LiveArgs {
	const args: LiveArgs = {
		dryRun: false,
		serial: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const current = argv[index];
		if (current === '--dry-run') {
			args.dryRun = true;
			continue;
		}
		if (current === '--serial') {
			args.serial = true;
			continue;
		}
		if (current === '--run-dir') {
			const value = argv[index + 1];
			assert(value, 'Expected a path after --run-dir');
			args.runDir = resolve(value);
			index += 1;
		}
	}

	return args;
}

export async function loadEnvironment(): Promise<Record<string, string>> {
	const merged: Record<string, string> = {};
	for (const name of ['.env', '.env.local']) {
		const path = join(ROOT_DIR, name);
		if (!existsSync(path)) {
			continue;
		}
		Object.assign(merged, await parseEnvFile(path));
	}

	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === 'string') {
			merged[key] = value;
		}
	}

	return merged;
}

export async function getClaudeAuthStatus(): Promise<ClaudeAuthStatus | null> {
	try {
		const { stdout } = await execFileAsync('claude', ['auth', 'status'], {
			cwd: ROOT_DIR,
			timeout: 15_000,
			maxBuffer: 1024 * 1024,
		});
		return JSON.parse(stdout) as ClaudeAuthStatus;
	} catch {
		return null;
	}
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatus | null> {
	try {
		const { stdout, stderr } = await execFileAsync('codex', ['login', 'status'], {
			cwd: ROOT_DIR,
			timeout: 15_000,
			maxBuffer: 1024 * 1024,
		});
		const line = `${stdout}\n${stderr}`.trim();
		if (!line) {
			return { loggedIn: false };
		}
		if (line.startsWith('Logged in using ')) {
			return {
				loggedIn: true,
				method: line.replace('Logged in using ', '').trim(),
			};
		}
		return { loggedIn: false, method: line };
	} catch {
		return null;
	}
}

export async function createRunRoot(args: LiveArgs): Promise<string> {
	if (args.runDir) {
		await mkdir(args.runDir, { recursive: true });
		return args.runDir;
	}

	const now = new Date();
	const stamp = `${[
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, '0'),
		String(now.getDate()).padStart(2, '0'),
	].join('-')}_${[
		String(now.getHours()).padStart(2, '0'),
		String(now.getMinutes()).padStart(2, '0'),
		String(now.getSeconds()).padStart(2, '0'),
	].join('')}`;

	const runRoot = join(ROOT_DIR, 'output', 'live-proof', stamp);
	await mkdir(runRoot, { recursive: true });
	return runRoot;
}

export async function createSuiteDir(runRoot: string, suite: SuiteName): Promise<string> {
	const dir = join(runRoot, suite);
	await mkdir(dir, { recursive: true });
	return dir;
}

export async function createCaseDir(
	suiteDir: string,
	scenarioId: string,
	caseId: string,
): Promise<string> {
	const dir = join(suiteDir, slugify(scenarioId), slugify(caseId));
	await mkdir(dir, { recursive: true });
	return dir;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

export async function writeText(path: string, value: string): Promise<void> {
	await writeFile(path, value, 'utf8');
}

export function requireEnv(env: Record<string, string>, key: string): string {
	const value = env[key];
	assert(
		value,
		`Missing ${key}. Run "pnpm live:setup" or add it to ${join(ROOT_DIR, '.env.local')}.`,
	);
	return value;
}

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

export async function flushMicrotasks(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

export function createAuditCollector() {
	const events: unknown[] = [];
	const sink = customSink('live-proof-collector', (event) => {
		events.push(sanitize(event));
	});
	return { events, sink };
}

export class ScriptedApprovalTransport implements HITLTransport {
	private readonly resolveDecision: (
		request: ApprovalRequest,
	) => ApprovalResponse | Promise<ApprovalResponse>;

	constructor(
		resolveDecision: (request: ApprovalRequest) => ApprovalResponse | Promise<ApprovalResponse>,
	) {
		this.resolveDecision = resolveDecision;
	}

	async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
		await sleep(50);
		return this.resolveDecision(request);
	}
}

export function approvedByScript(
	request: ApprovalRequest,
	respondedBy = 'live-proof-transport',
	note?: string,
): ApprovalResponse {
	return {
		requestId: request.id,
		decision: 'approve',
		respondedBy,
		respondedAt: new Date(),
		note,
	};
}

export function deniedByScript(
	request: ApprovalRequest,
	respondedBy = 'live-proof-transport',
	note?: string,
): ApprovalResponse {
	return {
		requestId: request.id,
		decision: 'deny',
		respondedBy,
		respondedAt: new Date(),
		note,
	};
}

export async function writeSuiteSummary(summary: SuiteSummary): Promise<void> {
	await writeJson(join(summary.runDir, 'summary.json'), summary);
	await writeText(join(summary.runDir, 'summary.md'), renderSuiteSummary(summary));
}

export function renderSuiteSummary(summary: SuiteSummary): string {
	const lines: string[] = [
		`# ${summary.suite.toUpperCase()} Live Proof`,
		'',
		`- Status: ${summary.status}`,
		`- Model: ${summary.model ?? 'n/a'}`,
		`- Started: ${summary.startedAt}`,
		`- Completed: ${summary.completedAt}`,
		'',
		'## Cases',
		'',
	];

	for (const item of summary.cases) {
		lines.push(
			`- ${item.status.toUpperCase()} ${item.scenarioId} / ${item.caseId}: expected ${item.expectedVerdict} via \`${item.expectedTool}\``,
		);
		if (item.failureReason) {
			lines.push(`  Reason: ${item.failureReason}`);
		}
		if (item.finalText) {
			lines.push(`  Final: ${item.finalText.replace(/\s+/g, ' ').slice(0, 220)}`);
		}
	}

	if (summary.notes.length > 0) {
		lines.push('', '## Notes', '');
		for (const note of summary.notes) {
			lines.push(`- ${note}`);
		}
	}

	lines.push('');
	return `${lines.join('\n')}\n`;
}

export async function readJsonFile<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T;
}

export function sanitize(value: unknown): unknown {
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
		};
	}
	if (Array.isArray(value)) {
		return value.map((entry) => sanitize(entry));
	}
	if (value && typeof value === 'object') {
		const output: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			output[key] = sanitize(entry);
		}
		return output;
	}
	return value;
}

export async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseEnvFile(path: string): Promise<Record<string, string>> {
	const raw = await readFile(path, 'utf8');
	const values: Record<string, string> = {};

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const separator = trimmed.indexOf('=');
		if (separator <= 0) {
			continue;
		}
		const key = trimmed.slice(0, separator).trim();
		const rawValue = trimmed.slice(separator + 1).trim();
		values[key] = rawValue.replace(/^['"]|['"]$/g, '');
	}

	return values;
}

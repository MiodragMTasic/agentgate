import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { ROOT_DIR, getClaudeAuthStatus, getCodexAuthStatus, loadEnvironment } from './shared.js';

const execFileAsync = promisify(execFile);

const OPENAI_KEYS_URL = 'https://platform.openai.com/api-keys';
const OPENAI_BILLING_URL = 'https://help.openai.com/en/articles/8156019';
const OPENAI_QUICKSTART_URL = 'https://platform.openai.com/docs/quickstart';
const ANTHROPIC_API_ACCESS_URL =
	'https://support.anthropic.com/en/articles/8114521-how-can-i-access-the-anthropic-api';
const ANTHROPIC_QUICKSTART_URL = 'https://docs.anthropic.com/en/docs/quickstart';
const ANTHROPIC_BILLING_URL =
	'https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console';

function parseFlags(argv: string[]) {
	return {
		editSecrets: argv.includes('--edit'),
		openOpenAI: argv.includes('--openai') || argv.includes('--both'),
		openAnthropic: argv.includes('--anthropic') || argv.includes('--both'),
	};
}

async function ensureLocalEnvFile(): Promise<{ path: string; created: boolean }> {
	const targetPath = join(ROOT_DIR, '.env.local');
	if (existsSync(targetPath)) {
		return { path: targetPath, created: false };
	}

	await copyFile(join(ROOT_DIR, '.env.local.example'), targetPath);
	return { path: targetPath, created: true };
}

async function openInBrowserOrEditor(targets: string[]): Promise<void> {
	if (targets.length === 0) {
		return;
	}

	if (process.platform !== 'darwin') {
		console.log('');
		console.log('Browser auto-open is only wired for macOS in this helper.');
		console.log('Open these URLs manually instead:');
		for (const target of targets) {
			console.log(`- ${target}`);
		}
		return;
	}

	for (const target of targets) {
		if (/^https?:\/\//.test(target)) {
			await execFileAsync('open', [target]);
			continue;
		}

		await execFileAsync('open', ['-e', target]);
	}
}

function printProviderStatus(name: string, configured: boolean, detail?: string): void {
	const suffix = detail ? ` (${detail})` : '';
	console.log(`${configured ? 'configured' : 'missing   '}  ${name}${suffix}`);
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	const envFile = await ensureLocalEnvFile();
	const env = await loadEnvironment();
	const claudeAuth = await getClaudeAuthStatus();
	const codexAuth = await getCodexAuthStatus();

	console.log('');
	console.log('AgentGate live-provider setup');
	console.log('================================');
	console.log('');
	console.log(`Workspace: ${ROOT_DIR}`);
	console.log(`Secrets file: ${envFile.path}`);
	console.log(
		envFile.created ? 'Status: created from .env.local.example' : 'Status: already present',
	);
	console.log('');
	console.log('Current provider status');
	printProviderStatus(
		'OpenAI',
		Boolean(codexAuth?.loggedIn) || Boolean(env.OPENAI_API_KEY),
		codexAuth?.loggedIn
			? `Codex ${codexAuth.method ?? 'login'}`
			: env.OPENAI_API_KEY
				? 'OPENAI_API_KEY'
				: 'needs Codex login or OPENAI_API_KEY',
	);
	printProviderStatus(
		'Anthropic',
		Boolean(env.ANTHROPIC_API_KEY) || Boolean(claudeAuth?.loggedIn),
		env.ANTHROPIC_API_KEY
			? 'ANTHROPIC_API_KEY'
			: claudeAuth?.loggedIn
				? `Claude Code ${claudeAuth.authMethod ?? 'auth'}`
				: 'needs ANTHROPIC_API_KEY or Claude Code login',
	);
	console.log('');
	console.log('How to use this');
	console.log('1. Open the secrets file above.');
	console.log('2. Paste in one or both API keys.');
	console.log('3. Run the matching live suite.');
	console.log('');
	console.log('Fast path');
	console.log('- OpenAI only:    pnpm live:openai');
	console.log('- OpenAI API key: pnpm live:openai -- --api');
	console.log('- Anthropic only: pnpm live:anthropic');
	console.log('- Local MCP only: pnpm live:mcp');
	console.log('- Everything:     pnpm live:matrix');
	console.log('');
	console.log('OpenAI note');
	console.log('- OpenAI live proof can run in two modes: Codex login or raw API key.');
	console.log(
		'- Primary path: if Codex already works on this machine, the harness can reuse that auth.',
	);
	console.log('- If not, run `codex login` in your terminal.');
	console.log('- Optional advanced path: use an OPENAI_API_KEY for the lower-level SDK proof.');
	console.log(`- API keys: ${OPENAI_KEYS_URL}`);
	console.log(`- Billing explainer: ${OPENAI_BILLING_URL}`);
	console.log(`- Quickstart: ${OPENAI_QUICKSTART_URL}`);
	console.log('');
	console.log('Anthropic note');
	console.log('- Anthropic live proof can run in two modes: API key or logged-in Claude Code.');
	console.log('- If Claude Code already works on this machine, the harness can reuse that auth.');
	console.log('- If not, run `claude auth login` or `claude setup-token` in your terminal.');
	console.log(`- API access: ${ANTHROPIC_API_ACCESS_URL}`);
	console.log(`- Quickstart: ${ANTHROPIC_QUICKSTART_URL}`);
	console.log(`- Billing explainer: ${ANTHROPIC_BILLING_URL}`);
	console.log('');
	console.log('Optional browser shortcuts');
	console.log('- pnpm live:setup -- --edit');
	console.log('- pnpm live:setup -- --openai');
	console.log('- pnpm live:setup -- --anthropic');
	console.log('- pnpm live:setup -- --both');

	const targetsToOpen: string[] = [];
	if (flags.editSecrets) {
		targetsToOpen.push(envFile.path);
	}
	if (flags.openOpenAI) {
		targetsToOpen.push(OPENAI_KEYS_URL, OPENAI_BILLING_URL);
	}
	if (flags.openAnthropic) {
		targetsToOpen.push(ANTHROPIC_API_ACCESS_URL, ANTHROPIC_QUICKSTART_URL, ANTHROPIC_BILLING_URL);
	}
	await openInBrowserOrEditor(targetsToOpen);
}

main().catch((error) => {
	console.error('[agentgate live:setup] failed');
	console.error(error);
	process.exitCode = 1;
});

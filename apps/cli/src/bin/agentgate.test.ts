import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const cliEntry = join(process.cwd(), 'dist/agentgate.js');

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'agentgate-cli-'));
	tempDirs.push(dir);
	return dir;
}

function writeScenarioFixture(
	dir: string,
	policy: string,
	scenarios: string,
): {
	policyPath: string;
	scenariosPath: string;
} {
	const policyPath = join(dir, 'agentgate.policy.yml');
	const scenariosPath = join(dir, 'agentgate.scenarios.yml');

	writeFileSync(policyPath, policy, 'utf8');
	writeFileSync(scenariosPath, scenarios, 'utf8');

	return { policyPath, scenariosPath };
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe('agentgate CLI', () => {
	it('init creates starter files that validate and test successfully', async () => {
		const dir = makeTempDir();

		const initResult = await execFileAsync('node', [cliEntry, 'init'], {
			cwd: dir,
		});
		expect(initResult.stdout).toContain('Created ./agentgate.policy.yml');
		expect(initResult.stdout).toContain('Created ./agentgate.scenarios.yml');
		expect(existsSync(join(dir, 'agentgate.policy.yml'))).toBe(true);
		expect(existsSync(join(dir, 'agentgate.scenarios.yml'))).toBe(true);
		expect(readFileSync(join(dir, 'agentgate.policy.yml'), 'utf8')).toContain('get_weather');

		const validateResult = await execFileAsync('node', [cliEntry, 'policy', 'validate'], {
			cwd: dir,
		});
		expect(validateResult.stdout).toContain('[PASS] Policy is valid');

		const testResult = await execFileAsync('node', [cliEntry, 'test'], {
			cwd: dir,
		});
		expect(testResult.stdout).toContain('2/2 scenarios passed');
	});

	it('passes when all scenarios match', async () => {
		const dir = makeTempDir();
		const { policyPath, scenariosPath } = writeScenarioFixture(
			dir,
			`version: "1"

defaults:
  verdict: deny

roles:
  user: {}

tools:
  get_weather:
    allow:
      - roles: [user]
`,
			`scenarios:
  - name: user can get weather
    tool: get_weather
    identity:
      id: user_1
      roles: [user]
    params:
      location: Toronto
    expected: allow
`,
		);

		const result = await execFileAsync(
			'node',
			[cliEntry, 'test', '--config', policyPath, '--scenarios', scenariosPath],
			{ cwd: process.cwd() },
		);

		expect(result.stdout).toContain('1/1 scenarios passed');
		expect(result.stdout).toContain('PASS');
	});

	it('exits non-zero when a scenario fails', async () => {
		const dir = makeTempDir();
		const { policyPath, scenariosPath } = writeScenarioFixture(
			dir,
			`version: "1"

defaults:
  verdict: deny

roles:
  user: {}

tools:
  get_weather:
    allow:
      - roles: [user]
`,
			`scenarios:
  - name: user should be denied
    tool: get_weather
    identity:
      id: user_1
      roles: [user]
    expected: deny
`,
		);

		await expect(
			execFileAsync(
				'node',
				[cliEntry, 'test', '--config', policyPath, '--scenarios', scenariosPath],
				{ cwd: process.cwd() },
			),
		).rejects.toMatchObject({
			code: 1,
			stdout: expect.stringContaining('FAIL'),
			stderr: expect.stringContaining('scenario(s) failed'),
		});
	});

	it('exits non-zero when the scenarios file is missing', async () => {
		const dir = makeTempDir();
		const policyPath = join(dir, 'agentgate.policy.yml');
		writeFileSync(
			policyPath,
			`version: "1"

defaults:
  verdict: deny

tools: {}
`,
			'utf8',
		);

		await expect(
			execFileAsync(
				'node',
				[
					cliEntry,
					'test',
					'--config',
					policyPath,
					'--scenarios',
					join(dir, 'missing.scenarios.yml'),
				],
				{ cwd: process.cwd() },
			),
		).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining('No scenarios file found'),
		});
	});

	it('prints capability discovery for a requested role', async () => {
		const dir = makeTempDir();
		const { policyPath } = writeScenarioFixture(
			dir,
			`version: "1"

defaults:
  verdict: deny

roles:
  admin:
    inherits: [user]
  user: {}

tools:
  get_weather:
    allow:
      - roles: [user]
  delete_user:
    allow:
      - roles: [admin]
`,
			'scenarios: []',
		);

		const result = await execFileAsync(
			'node',
			[cliEntry, 'capability', '--config', policyPath, '--role', 'admin'],
			{ cwd: process.cwd() },
		);

		expect(result.stdout).toContain('Capabilities for role: admin');
		expect(result.stdout).toContain('get_weather');
		expect(result.stdout).toContain('delete_user');
		expect(result.stdout).toContain('ALLOW');
	});
});

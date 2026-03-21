import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedRepository = 'https://github.com/MiodragMTasic/agentgate';
const publishablePackageJsonPaths = [
	'packages/core/package.json',
	'packages/anthropic/package.json',
	'packages/openai/package.json',
	'packages/mcp/package.json',
	'apps/cli/package.json',
];

function readJson(path) {
	return JSON.parse(readFileSync(resolve(rootDir, path), 'utf8'));
}

function npmView(packageName) {
	try {
		const output = execFileSync(
			'npm',
			[
				'--userconfig',
				'/dev/null',
				'view',
				packageName,
				'version',
				'repository.url',
				'homepage',
				'--json',
			],
			{ cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
		);
		return JSON.parse(output);
	} catch (error) {
		const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
		if (stderr.includes('E404')) {
			return null;
		}
		throw error;
	}
}

const conflicts = [];

for (const packagePath of publishablePackageJsonPaths) {
	const pkg = readJson(packagePath);
	const published = npmView(pkg.name);
	if (!published) {
		continue;
	}

	const publishedRepository =
		typeof published['repository.url'] === 'string'
			? published['repository.url']
			: typeof published.homepage === 'string'
				? published.homepage
				: '';

	if (!publishedRepository.includes('MiodragMTasic/agentgate')) {
		conflicts.push({
			name: pkg.name,
			version: published.version,
			repository: publishedRepository || '(unknown repository)',
		});
	}
}

if (conflicts.length > 0) {
	console.error('Release is blocked by npm namespace conflicts.\n');
	for (const conflict of conflicts) {
		console.error(
			`- ${conflict.name} is already published at ${conflict.version} by ${conflict.repository}`,
		);
	}
	console.error(`\nExpected repository: ${expectedRepository}`);
	console.error(
		'Resolve package ownership or rename the publishable package names before publishing.',
	);
	process.exit(1);
}

console.log('Release readiness check passed: no npm namespace conflicts detected.');

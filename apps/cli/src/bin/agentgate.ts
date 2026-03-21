import { auditCommand } from '../commands/audit.js';
import { capabilityCommand } from '../commands/capability.js';
import { initCommand } from '../commands/init.js';
import { validateCommand } from '../commands/policy/validate.js';
import { testCommand } from '../commands/test.js';

const HELP = `
agentgate - Permission middleware for AI agents

Usage:
  agentgate <command> [options]

Commands:
  init                Initialize AgentGate in current project
  test                Dry-run policy evaluation against test scenarios
  audit               View decision audit log
  policy validate     Validate policy file(s)
  capability          Show what a role can access

Options:
  --config, -c        Path to policy file (default: ./agentgate.policy.yml)
  --scenarios, -s     Path to test scenarios file (default: ./agentgate.scenarios.yml)
  --help, -h          Show this help
  --version, -v       Show version

Examples:
  agentgate init
  agentgate test --config ./policies.yml --scenarios ./agentgate.scenarios.yml
  agentgate capability --role user
  agentgate policy validate
`;

function getFlagValue(args: string[], flags: string[]): string | undefined {
	const index = args.findIndex((arg) => flags.includes(arg));
	if (index >= 0) {
		return args[index + 1];
	}

	return undefined;
}

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === '--help' || command === '-h') {
		console.log(HELP);
		return;
	}

	if (command === '--version' || command === '-v') {
		console.log('agentgate v0.1.0');
		return;
	}

	const configPath = getFlagValue(args, ['--config', '-c']) ?? './agentgate.policy.yml';
	const scenariosPath = getFlagValue(args, ['--scenarios', '-s']) ?? './agentgate.scenarios.yml';

	switch (command) {
		case 'init':
			await initCommand();
			break;
		case 'test':
			await testCommand(configPath, scenariosPath);
			break;
		case 'audit':
			await auditCommand();
			break;
		case 'policy': {
			const sub = args[1];
			if (sub === 'validate') {
				await validateCommand(configPath);
			} else {
				console.error(`Unknown policy subcommand: ${sub}`);
				process.exit(1);
			}
			break;
		}
		case 'capability': {
			const role = getFlagValue(args, ['--role']);
			if (!role) {
				console.error('Usage: agentgate capability --role <role>');
				process.exit(1);
			}
			await capabilityCommand(configPath, role);
			break;
		}
		default:
			console.error(`Unknown command: ${command}`);
			console.log(HELP);
			process.exit(1);
	}
}

main().catch((err) => {
	console.error(err.message ?? err);
	process.exit(1);
});

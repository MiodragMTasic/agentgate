import { initCommand } from '../commands/init.js';
import { validateCommand } from '../commands/policy/validate.js';
import { capabilityCommand } from '../commands/capability.js';
import { testCommand } from '../commands/test.js';
import { auditCommand } from '../commands/audit.js';

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
  --help, -h          Show this help
  --version, -v       Show version

Examples:
  agentgate init
  agentgate test --config ./policies.yml
  agentgate capability --role user
  agentgate policy validate
`;

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

	const configArg = args.find((a, i) => (a === '--config' || a === '-c') && args[i + 1]);
	const configIdx = args.findIndex((a) => a === '--config' || a === '-c');
	const configPath = configIdx >= 0 ? args[configIdx + 1] : './agentgate.policy.yml';

	switch (command) {
		case 'init':
			await initCommand();
			break;
		case 'test':
			await testCommand(configPath!);
			break;
		case 'audit':
			await auditCommand(configPath!);
			break;
		case 'policy': {
			const sub = args[1];
			if (sub === 'validate') {
				await validateCommand(configPath!);
			} else {
				console.error(`Unknown policy subcommand: ${sub}`);
				process.exit(1);
			}
			break;
		}
		case 'capability': {
			const roleArg = args.find((a, i) => a === '--role' && args[i + 1]);
			const roleIdx = args.findIndex((a) => a === '--role');
			const role = roleIdx >= 0 ? args[roleIdx + 1] : undefined;
			if (!role) {
				console.error('Usage: agentgate capability --role <role>');
				process.exit(1);
			}
			await capabilityCommand(configPath!, role);
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

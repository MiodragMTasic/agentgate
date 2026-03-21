import * as fs from 'node:fs';

export async function auditCommand(configPath: string): Promise<void> {
	const auditPath = './audit.log';

	console.log('');
	console.log('  AgentGate Audit Log');
	console.log('  ' + '='.repeat(50));
	console.log('');

	if (!fs.existsSync(auditPath)) {
		console.log('  No audit log found at ./audit.log');
		console.log('  Enable file audit logging in your AgentGate config:');
		console.log('');
		console.log('    import { fileSink } from "@agentgate/core";');
		console.log('    const gate = new AgentGate({');
		console.log('      audit: { sinks: [fileSink("./audit.log")] }');
		console.log('    });');
		console.log('');
		return;
	}

	const content = fs.readFileSync(auditPath, 'utf-8');
	const lines = content.trim().split('\n').filter(Boolean);

	if (lines.length === 0) {
		console.log('  Audit log is empty.');
		console.log('');
		return;
	}

	console.log('  TIME                TOOL              USER          VERDICT    REASON');
	console.log('  ' + '-'.repeat(80));

	const recentLines = lines.slice(-50); // Show last 50 events

	for (const line of recentLines) {
		try {
			const event = JSON.parse(line);
			const time = new Date(event.timestamp).toLocaleTimeString().padEnd(20);
			const tool = (event.tool ?? '').padEnd(18);
			const user = (event.identity?.id ?? '').padEnd(14);
			const verdict = event.type?.includes('allowed')
				? 'ALLOW'
				: event.type?.includes('denied')
					? 'DENY'
					: 'PENDING';
			const verdictPad = verdict.padEnd(11);
			const reason = event.decision?.reason ?? '';

			console.log(`  ${time}${tool}${user}${verdictPad}${reason}`);
		} catch {
			// Skip malformed lines
		}
	}

	console.log('');
	console.log(`  Showing ${recentLines.length} of ${lines.length} events`);
	console.log('');
}

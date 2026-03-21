import { createInterface } from 'node:readline';
import type { ApprovalRequest, ApprovalResponse, HITLTransport } from './types.js';

export class ConsoleTransport implements HITLTransport {
	async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		const prompt = [
			'',
			'═══════════════════════════════════════════',
			'  APPROVAL REQUIRED',
			'═══════════════════════════════════════════',
			`  Tool:    ${request.tool}`,
			`  Reason:  ${request.reason}`,
			`  Rule:    ${request.matchedRule}`,
			`  Agent:   ${request.identity.id}`,
			`  Params:  ${JSON.stringify(request.params)}`,
			`  Expires: ${request.expiresAt.toISOString()}`,
			'═══════════════════════════════════════════',
			'',
		].join('\n');

		process.stdout.write(prompt);

		const answer = await new Promise<string>((resolve) => {
			rl.question('  Approve? (y/n): ', (ans: string) => {
				resolve(ans.trim().toLowerCase());
				rl.close();
			});
		});

		return {
			requestId: request.id,
			decision: answer === 'y' || answer === 'yes' ? 'approve' : 'deny',
			respondedBy: 'console',
			respondedAt: new Date(),
		};
	}
}

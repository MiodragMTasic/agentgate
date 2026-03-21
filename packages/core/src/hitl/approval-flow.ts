import { ApprovalQueue } from './queue.js';
import type { ApprovalRequest, ApprovalResponse, HITLTransport } from './types.js';

export interface ApprovalFlowOptions {
	transport: HITLTransport;
	timeout: number;
	timeoutAction: 'deny' | 'allow';
}

export class ApprovalFlow {
	private readonly transport: HITLTransport;
	private readonly timeout: number;
	private readonly timeoutAction: 'deny' | 'allow';
	private readonly queue = new ApprovalQueue();

	constructor(options: ApprovalFlowOptions) {
		this.transport = options.transport;
		this.timeout = options.timeout;
		this.timeoutAction = options.timeoutAction;
	}

	async requestApproval(request: ApprovalRequest): Promise<boolean> {
		this.queue.add(request);

		const response = await Promise.race([
			this.transport.requestApproval(request),
			this.waitForTimeout(request.id),
		]);

		if (!response) {
			request.status = 'expired';
			return this.timeoutAction === 'allow';
		}

		this.queue.resolve(request.id, response);
		return response.decision === 'approve';
	}

	getQueue(): ApprovalQueue {
		return this.queue;
	}

	private waitForTimeout(requestId: string): Promise<ApprovalResponse | null> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				const pending = this.queue.get(requestId);
				if (pending) {
					pending.status = 'expired';
				}
				resolve(null);
			}, this.timeout);

			if (typeof timer === 'object' && 'unref' in timer) {
				timer.unref();
			}
		});
	}
}

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
	private readonly inflight = new Map<string, Promise<boolean>>();

	constructor(options: ApprovalFlowOptions) {
		this.transport = options.transport;
		this.timeout = options.timeout;
		this.timeoutAction = options.timeoutAction;
	}

	async requestApproval(request: ApprovalRequest): Promise<boolean> {
		const pending = this.inflight.get(request.id);
		if (pending) {
			return pending;
		}

		const promise = this.runApproval(request);
		this.inflight.set(request.id, promise);

		try {
			return await promise;
		} finally {
			this.inflight.delete(request.id);
		}
	}

	getQueue(): ApprovalQueue {
		return this.queue;
	}

	waitForApproval(requestId: string): Promise<boolean> | null {
		return this.inflight.get(requestId) ?? null;
	}

	private async runApproval(request: ApprovalRequest): Promise<boolean> {
		this.queue.add(request);

		const response = await Promise.race([
			this.transport.requestApproval(request),
			this.waitForTimeout(request.id),
		]);

		if (!response) {
			request.status = 'expired';
			return this.timeoutAction === 'allow';
		}

		request.status = response.decision === 'approve' ? 'approved' : 'denied';
		this.queue.resolve(request.id, response);
		return response.decision === 'approve';
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

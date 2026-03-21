import type { ApprovalRequest, ApprovalResponse } from './types.js';

export class ApprovalQueue {
	private readonly pending = new Map<string, ApprovalRequest>();
	private resolvedCallback?: (request: ApprovalRequest, response: ApprovalResponse) => void;

	add(request: ApprovalRequest): void {
		this.pruneExpired();
		this.pending.set(request.id, request);
	}

	resolve(requestId: string, response: ApprovalResponse): void {
		const request = this.pending.get(requestId);
		if (!request) return;

		request.status = response.decision === 'approve' ? 'approved' : 'denied';
		this.pending.delete(requestId);
		this.resolvedCallback?.(request, response);
	}

	get(requestId: string): ApprovalRequest | undefined {
		this.pruneExpired();
		return this.pending.get(requestId);
	}

	getPending(): ApprovalRequest[] {
		this.pruneExpired();
		return [...this.pending.values()];
	}

	onResolved(callback: (request: ApprovalRequest, response: ApprovalResponse) => void): void {
		this.resolvedCallback = callback;
	}

	private pruneExpired(): void {
		const now = new Date();
		for (const [id, request] of this.pending) {
			if (request.expiresAt <= now) {
				request.status = 'expired';
				this.pending.delete(id);
			}
		}
	}
}

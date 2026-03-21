import type { Identity } from '../context/types.js';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
	id: string;
	tool: string;
	params: Record<string, unknown>;
	identity: Identity;
	reason: string;
	matchedRule: string;
	requestedAt: Date;
	expiresAt: Date;
	status: ApprovalStatus;
}

export type ApprovalDecision = 'approve' | 'deny';

export interface ApprovalResponse {
	requestId: string;
	decision: ApprovalDecision;
	respondedBy: string;
	respondedAt: Date;
	note?: string;
}

export interface HITLTransport {
	requestApproval(request: ApprovalRequest): Promise<ApprovalResponse>;
	close?(): Promise<void>;
}

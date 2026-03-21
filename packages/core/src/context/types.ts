export interface Identity {
	id: string;
	roles: string[];
	attributes?: Record<string, unknown>;
	orgId?: string;
}

export interface GateRequest {
	tool: string;
	params: Record<string, unknown>;
	identity: Identity;
	context?: Record<string, unknown>;
}

export type GateVerdict = 'allow' | 'deny' | 'pending_approval';

export interface GateDecision {
	verdict: GateVerdict;
	reason: string;
	matchedRule?: string;
	approvalId?: string;
	sanitizedParams?: Record<string, unknown>;
	evaluationTimeMs: number;
	decisionId: string;
	timestamp: Date;
}

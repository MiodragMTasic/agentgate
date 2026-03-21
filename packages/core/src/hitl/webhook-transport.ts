import http from 'node:http';
import https from 'node:https';
import type {
	ApprovalDecision,
	ApprovalRequest,
	ApprovalResponse,
	HITLTransport,
} from './types.js';

export interface WebhookTransportOptions {
	url: string;
	pollInterval?: number;
	headers?: Record<string, string>;
}

export class WebhookTransport implements HITLTransport {
	private readonly url: string;
	private readonly pollInterval: number;
	private readonly headers: Record<string, string>;

	constructor(options: WebhookTransportOptions) {
		this.url = options.url;
		this.pollInterval = options.pollInterval ?? 3000;
		this.headers = options.headers ?? {};
	}

	async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
		const body = JSON.stringify({
			id: request.id,
			tool: request.tool,
			params: request.params,
			identity: request.identity,
			reason: request.reason,
			matchedRule: request.matchedRule,
			requestedAt: request.requestedAt.toISOString(),
			expiresAt: request.expiresAt.toISOString(),
		});

		const { callbackUrl } = await this.post(this.url, body);

		return this.pollForResponse(callbackUrl ?? `${this.url}/${request.id}`, request);
	}

	private post(url: string, body: string): Promise<{ callbackUrl?: string }> {
		return new Promise((resolve, reject) => {
			const parsed = new URL(url);
			const transport = parsed.protocol === 'https:' ? https : http;

			const req = transport.request(
				url,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Content-Length': Buffer.byteLength(body),
						...this.headers,
					},
				},
				(res: http.IncomingMessage) => {
					let data = '';
					res.on('data', (chunk: Buffer) => {
						data += chunk.toString();
					});
					res.on('end', () => {
						if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
							try {
								resolve(JSON.parse(data));
							} catch {
								resolve({});
							}
						} else {
							reject(new Error(`Webhook POST failed with status ${res.statusCode}`));
						}
					});
				},
			);

			req.on('error', reject);
			req.write(body);
			req.end();
		});
	}

	private async pollForResponse(
		callbackUrl: string,
		request: ApprovalRequest,
	): Promise<ApprovalResponse> {
		while (new Date() < request.expiresAt) {
			await this.sleep(this.pollInterval);

			const result = await this.get(callbackUrl);

			if (result?.decision) {
				return {
					requestId: request.id,
					decision: result.decision as ApprovalDecision,
					respondedBy: (result.respondedBy as string) ?? 'webhook',
					respondedAt: result.respondedAt ? new Date(result.respondedAt as string) : new Date(),
					note: result.note as string | undefined,
				};
			}
		}

		return {
			requestId: request.id,
			decision: 'deny',
			respondedBy: 'webhook-timeout',
			respondedAt: new Date(),
			note: 'Polling timed out waiting for response',
		};
	}

	private get(url: string): Promise<Record<string, unknown> | null> {
		return new Promise((resolve, reject) => {
			const parsed = new URL(url);
			const transport = parsed.protocol === 'https:' ? https : http;

			const req = transport.request(
				url,
				{ method: 'GET', headers: this.headers },
				(res: http.IncomingMessage) => {
					let data = '';
					res.on('data', (chunk: Buffer) => {
						data += chunk.toString();
					});
					res.on('end', () => {
						if (res.statusCode === 200) {
							try {
								resolve(JSON.parse(data) as Record<string, unknown>);
							} catch {
								resolve(null);
							}
						} else if (res.statusCode === 202 || res.statusCode === 404) {
							resolve(null);
						} else {
							reject(new Error(`Webhook GET failed with status ${res.statusCode}`));
						}
					});
				},
			);

			req.on('error', reject);
			req.end();
		});
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => {
			const timer = setTimeout(resolve, ms);
			if (typeof timer === 'object' && 'unref' in timer) {
				timer.unref();
			}
		});
	}
}

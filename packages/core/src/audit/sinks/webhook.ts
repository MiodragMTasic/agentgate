import http from 'node:http';
import https from 'node:https';

import type { AuditSink } from '../types.js';

export interface WebhookSinkOptions {
	headers?: Record<string, string>;
	timeoutMs?: number;
}

export function webhookSink(url: string, options?: WebhookSinkOptions): AuditSink {
	return {
		name: 'webhook',
		write(event) {
			return new Promise<void>((resolve, reject) => {
				const parsed = new URL(url);
				const transport = parsed.protocol === 'https:' ? https : http;
				const body = JSON.stringify(event);
				const timeoutMs = options?.timeoutMs ?? 5000;

				const req = transport.request(
					parsed,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Content-Length': Buffer.byteLength(body),
							...options?.headers,
						},
						timeout: timeoutMs,
					},
					(res: http.IncomingMessage) => {
						res.resume();
						res.on('end', resolve);
					},
				);

				req.on('error', reject);
				req.on('timeout', () => {
					req.destroy();
					reject(new Error(`Webhook request to ${url} timed out after ${timeoutMs}ms`));
				});

				req.end(body);
			});
		},
	};
}

import type { IncomingMessage, ServerResponse } from 'node:http';

import { createChatGptConnectionInfo } from '../src/mcp/chatgpt-connection.js';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    res.writeHead(405, {
      allow: 'GET',
      'content-type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const forwardedProto = req.headers['x-forwarded-proto']?.toString().split(',')[0]?.trim();
  const protocol = forwardedProto || 'https';
  const forwardedHost = req.headers['x-forwarded-host']?.toString().split(',')[0]?.trim();
  const host = forwardedHost || req.headers.host || 'visual-director-beta.vercel.app';
  const origin = `${protocol}://${host}`;

  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(createChatGptConnectionInfo(origin)));
}

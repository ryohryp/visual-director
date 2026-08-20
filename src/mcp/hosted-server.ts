import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';

import { registerApprovedEditSourceTool } from './approved-edit-source.js';
import { createVisualDirectorServer } from './server.js';
import type { VisualDirectorServerOptions } from './server.js';

/**
 * Hosted deployments use the v2 request-scoped MCP handler. The handler serves
 * protocol 2026-07-28 and, through its default stateless legacy fallback, the
 * 2025-era protocol revisions without retaining an in-memory session map.
 */
export function createHostedHttpServerForVisualDirector(options: VisualDirectorServerOptions = {}): Server {
  return createHttpServer((req, res) => {
    void handleHostedHttpRequest(req, res, options).catch((error: unknown) => {
      writeHostedError(res, error);
    });
  });
}

async function handleHostedHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: VisualDirectorServerOptions,
): Promise<void> {
  const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

  if (req.method === 'GET' && pathname === '/health') {
    writeHealthResponse(res);
    return;
  }

  if (pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not_found', path: pathname }));
    return;
  }

  await handleHostedMcpRequest(req, res, options);
}

/** Vercel Function-compatible request-scoped MCP handler for both protocol eras. */
export async function handleHostedMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: VisualDirectorServerOptions = {},
): Promise<void> {
  const requestId: string = req.headers['x-request-id']?.toString() || randomUUID();
  res.setHeader('x-request-id', requestId);

  if (req.method !== 'POST') {
    logHostedEvent('route_rejected', requestId, { method: req.method ?? 'UNKNOWN', reason: 'post_required' });
    res.writeHead(405, {
      allow: 'POST',
      'content-type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: 'Hosted Visual Director uses stateless POST-only MCP over HTTP.',
        data: { kind: 'MCP_ROUTING_ERROR', request_id: requestId, retryable: false },
      },
    }));
    return;
  }

  logHostedEvent('request_received', requestId, { method: 'POST', path: '/mcp' });
  const handler = createMcpHandler(() => {
    const server = createVisualDirectorServer({ ...options, enableGenerationTool: false });
    registerApprovedEditSourceTool(server);
    return server;
  });
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => {
      logHostedEvent('transport_error', requestId, { message: error.message, retryable: true });
    },
  });

  try {
    await nodeHandler(req, res);
    logHostedEvent('request_completed', requestId, { status_code: res.statusCode });
  } catch (error) {
    writeHostedError(res, error, requestId);
  } finally {
    await handler.close().catch(() => undefined);
  }
}

export function writeHealthResponse(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ status: 'ok', service: 'visual-director', mode: 'hosted-read-only' }));
}

function writeHostedError(res: ServerResponse, error: unknown, requestId: string = randomUUID()): void {
  const message = error instanceof Error ? error.message : String(error);
  logHostedEvent('request_failed', requestId, { message, retryable: true });
  if (res.headersSent || res.writableEnded) {
    if (!res.destroyed) res.destroy(error instanceof Error ? error : undefined);
    return;
  }
  res.setHeader('x-request-id', requestId);
  res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32001,
      message: 'Hosted MCP request failed before the tool response completed. Reconnect and retry.',
      data: {
        kind: 'HOSTED_MCP_TRANSIENT_FAILURE',
        request_id: requestId,
        retryable: true,
        reconnect: true,
        cause: message,
      },
    },
  }));
}

function logHostedEvent(event: string, requestId: string, details: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify({
    service: 'visual-director',
    component: 'hosted-mcp',
    event,
    request_id: requestId,
    ...details,
  })}\n`);
}

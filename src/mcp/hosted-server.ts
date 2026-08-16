import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';

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
    res.end(JSON.stringify({ error: 'not_found' }));
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
  if (req.method !== 'POST') {
    res.writeHead(405, {
      allow: 'POST',
      'content-type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Hosted Visual Director uses stateless POST-only MCP over HTTP.' },
    }));
    return;
  }

  const handler = createMcpHandler(() => createVisualDirectorServer(options));
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => {
      process.stderr.write(`[visual-director] hosted MCP transport error: ${error.message}\n`);
    },
  });

  try {
    await nodeHandler(req, res);
  } catch (error) {
    writeHostedError(res, error);
  } finally {
    await handler.close().catch(() => undefined);
  }
}

export function writeHealthResponse(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ status: 'ok', service: 'visual-director', mode: 'hosted-read-only' }));
}

function writeHostedError(res: ServerResponse, error: unknown): void {
  if (res.headersSent || res.writableEnded) {
    if (!res.destroyed) res.destroy(error instanceof Error ? error : undefined);
    return;
  }
  res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32603,
      message: 'Internal hosted MCP transport error.',
      data: error instanceof Error ? error.message : String(error),
    },
  }));
}

import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { BottomOfThirstAdapter } from '../projects/bottom-of-thirst/adapter.js';
import { VisualDirectorError } from '../domain/types.js';
import type { PrepareGenerationInput, ProjectAdapter } from '../domain/types.js';

export interface VisualDirectorServerOptions {
  repoPath?: string;
}

export function createVisualDirectorServer(options: VisualDirectorServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'visual-director', version: '0.1.0' },
    {
      instructions:
        'Use visual.prepare_generation when the user asks to prepare a game image-generation package. Supply project_id, asset_type, subject_ids, request_text, and optional scene_context. This read-only tool validates the configured Visual Canon and never generates images or calls an image API. Report explicit errors and never invent a fallback package or substitute candidate or legacy assets.',
    },
  );
  server.registerTool(
    'visual.prepare_generation',
    {
      title: 'Prepare visual generation',
      description:
        'Read the configured project Visual Canon and return a fail-closed Generation Package for an image model. This tool never generates images or calls an image API.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        project_id: z.string().min(1),
        asset_type: z.string().min(1),
        subject_ids: z.array(z.string().min(1)).min(1),
        request_text: z.string().min(1),
        scene_context: z.record(z.string(), z.unknown()).optional(),
      },
      outputSchema: {
        project_id: z.string(),
        asset_type: z.string(),
        prompt_package: z.object({
          style_lock: z.string(),
          subject_lock: z.array(z.string()),
          scene_requirements: z.array(z.string()),
          allowed_changes: z.array(z.string()),
          forbidden_changes: z.array(z.string()),
          avoid_block: z.array(z.string()),
        }),
        reference_assets: z.array(
          z.object({
            role: z.enum(['global_reference', 'subject_anchor']),
            path: z.string(),
            subject_id: z.string().optional(),
          }),
        ),
        policy: z.object({
          must_use_approved_anchor: z.literal(true),
          must_not_chain_from_candidate: z.literal(true),
          must_review_after_generation: z.literal(true),
        }),
      },
    },
    async (input) => {
      try {
        const adapter = resolveAdapter(input.project_id, options);
        const generationPackage = await adapter.prepare(input as PrepareGenerationInput);
        return {
          structuredContent: { ...generationPackage } as Record<string, unknown>,
          content: [{ type: 'text' as const, text: JSON.stringify(generationPackage, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(serializeError(error), null, 2) }],
        };
      }
    },
  );
  return server;
}

function resolveAdapter(projectId: string, options: VisualDirectorServerOptions): ProjectAdapter {
  if (projectId !== 'bottom-of-thirst') {
    throw new VisualDirectorError('PROJECT_NOT_FOUND', `Unsupported project_id: ${projectId}.`);
  }
  const repoPath = options.repoPath ?? process.env.BOTTOM_OF_THIRST_REPO_PATH;
  if (!repoPath) {
    throw new VisualDirectorError(
      'PROJECT_CONFIG_MISSING',
      'BOTTOM_OF_THIRST_REPO_PATH is not configured. Set it to an absolute checkout path before calling this tool.',
    );
  }
  return new BottomOfThirstAdapter({ repoPath });
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof VisualDirectorError) {
    return { error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  }
  return {
    error: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function runStdio(options: VisualDirectorServerOptions = {}): Promise<void> {
  const server = createVisualDirectorServer(options);
  await server.connect(new StdioServerTransport());
}

interface HttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export function createHttpServerForVisualDirector(
  options: VisualDirectorServerOptions = {},
): { httpServer: Server; sessions: Map<string, HttpSession> } {
  const sessions = new Map<string, HttpSession>();
  const httpServer = createHttpServer((req, res) => {
    void handleHttpRequest(req, res, options, sessions);
  });
  return { httpServer, sessions };
}

async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: VisualDirectorServerOptions,
  sessions: Map<string, HttpSession>,
): Promise<void> {
  if (req.url !== '/mcp') {
    writeJson(res, 404, { error: 'not_found' });
    return;
  }

  const sessionId = headerValue(req.headers['mcp-session-id']);
  if (req.method === 'DELETE') {
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      writeJson(res, 404, { error: 'session_not_found' });
      return;
    }
    sessions.delete(sessionId as string);
    await session.transport.close();
    res.writeHead(204).end();
    return;
  }

  let session = sessionId ? sessions.get(sessionId) : undefined;
  if (sessionId && !session) {
    writeJson(res, 404, { error: 'session_not_found' });
    return;
  }

  if (!session) {
    const server = createVisualDirectorServer(options);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });
    session = { server, transport };
    transport.onclose = () => {
      const currentId = transport.sessionId;
      if (currentId) sessions.delete(currentId);
    };
    await server.connect(transport);
  }

  try {
    await session.transport.handleRequest(req, res);
    const assignedId = session.transport.sessionId;
    if (assignedId) sessions.set(assignedId, session);
  } catch (error) {
    if (!res.headersSent) {
      writeJson(res, 500, serializeError(error));
    } else {
      res.destroy(error instanceof Error ? error : undefined);
    }
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function writeJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

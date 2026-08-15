import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createVisualDirectorCore } from '../core/visual-director.js';
import { VisualDirectorError } from '../domain/types.js';
import { createProjectRegistry } from '../projects/registry.js';
import type { ProjectRegistry } from '../projects/registry.js';

export interface VisualDirectorServerOptions {
  repoPath?: string;
  projectsConfigPath?: string;
}

export function createVisualDirectorServer(
  options: VisualDirectorServerOptions = {},
  registry: ProjectRegistry = createProjectRegistry(options),
): McpServer {
  const core = createVisualDirectorCore(options, registry);
  const server = new McpServer(
    { name: 'visual-director', version: '0.2.0' },
    {
      instructions:
        'Visual Director is a fail-closed gate before image generation. visual.prepare_generation delegates Canon resolution and package construction to the MCP-independent Visual Director Core. Proceed to an image model only after that exact request returns a successful Generation Package with non-empty style_lock and subject_lock. If preparation returns a Canon validation error, do not reconstruct or guess character facts from memory, conversation history, legacy assets, or prior candidates. An explicit scene_context.repository_path is sufficient for that request and does not require prior MCP session state. For backward compatibility, the MCP adapter also remembers a valid explicit repository path as a runtime binding for subsequent calls in the same server lifecycle. visual.configure_project remains available for explicit runtime binding. Transport/session failures are connectivity errors, not Canon validation results. visual.adopt_anchor may only be called after explicit user approval. Visual Director never generates images or calls an image API.',
    },
  );

  server.registerTool(
    'visual.configure_project',
    {
      title: 'Configure project repository',
      description:
        'Backward-compatible runtime binding for a known project. Preparation can also use an explicit request-scoped scene_context.repository_path without this call.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        project_id: z.string().min(1),
        repository_path: z.string().min(1),
      },
      outputSchema: {
        project_id: z.string(),
        repository_path: z.string(),
        persistence: z.literal('runtime'),
      },
    },
    async (input) => {
      try {
        const configuration = await core.configureProject(input.project_id, input.repository_path);
        return {
          structuredContent: { ...configuration } as Record<string, unknown>,
          content: [{ type: 'text' as const, text: JSON.stringify(configuration, null, 2) }],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'visual.adopt_anchor',
    {
      title: 'Adopt Anchor and register Canon',
      description:
        'After explicit user approval, adopt one image as the subject Approved Visual Anchor. candidate_file accepts the ChatGPT/OpenAI file reference supplied by the host; candidate_path remains the repository-relative compatibility input.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        project_id: z.string().min(1),
        subject_id: z.string().min(1),
        candidate_file: z.object({
          download_url: z.string().url(),
          file_id: z.string().min(1),
          mime_type: z.string().min(1).optional(),
          file_name: z.string().min(1).optional(),
        }).optional(),
        candidate_path: z.string().min(1).optional(),
        approval: z.literal('approve'),
      },
      _meta: {
        'openai/fileParams': ['candidate_file'],
      },
      outputSchema: {
        project_id: z.string(),
        subject_id: z.string(),
        status: z.literal('approved'),
        anchor_path: z.string(),
        approved_anchor_path: z.string(),
        canon_path: z.string(),
        changed: z.boolean(),
        sha256: z.string(),
        mime_type: z.string(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      },
    },
    async (input) => {
      try {
        const result = await core.adoptAnchor(input);
        return {
          structuredContent: { ...result } as Record<string, unknown>,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'visual.prepare_generation',
    {
      title: 'Prepare visual generation',
      description:
        'Return a fail-closed Generation Package from the MCP-independent Visual Director Core. An explicit scene_context.repository_path is sufficient for the current request and stripped before prompt construction; the MCP adapter also preserves it as a backward-compatible runtime binding.',
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
          must_use_approved_anchor: z.boolean(),
          must_not_chain_from_candidate: z.literal(true),
          must_review_after_generation: z.literal(true),
        }),
      },
    },
    async (input) => {
      try {
        const repositoryPath = input.scene_context?.repository_path;
        if (typeof repositoryPath === 'string' && repositoryPath.trim()) {
          // Compatibility only: Core preparation itself remains request-scoped and
          // does not need this runtime binding to succeed.
          await core.configureProject(input.project_id, repositoryPath);
        }
        const generationPackage = await core.prepareGeneration(input);
        return {
          structuredContent: { ...generationPackage } as Record<string, unknown>,
          content: [{ type: 'text' as const, text: JSON.stringify(generationPackage, null, 2) }],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(serializeError(error), null, 2) }],
  };
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
  const transport = new StdioServerTransport();
  transport.onerror = (error) => {
    logToStderr('MCP transport error', error);
  };
  try {
    await server.connect(transport);
  } catch (error) {
    logToStderr('stdio connection failed', error);
    await closeTransportAfterConnectionFailure(transport);
    throw error;
  }
}

interface HttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export function createHttpServerForVisualDirector(
  options: VisualDirectorServerOptions = {},
): { httpServer: Server; sessions: Map<string, HttpSession> } {
  const sessions = new Map<string, HttpSession>();
  const registry = createProjectRegistry(options);
  const httpServer = createHttpServer((req, res) => {
    void handleHttpRequest(req, res, options, sessions, registry).catch((error: unknown) => {
      writeHttpRequestError(res, error);
    });
  });
  return { httpServer, sessions };
}

async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: VisualDirectorServerOptions,
  sessions: Map<string, HttpSession>,
  registry: ProjectRegistry,
): Promise<void> {
  let newlyCreatedSession: HttpSession | undefined;
  let connected = false;

  try {
    if (req.url !== '/mcp') {
      writeJson(res, 404, { error: 'not_found' });
      return;
    }

    const sessionId = headerValue(req.headers['mcp-session-id']);
    if (req.method === 'DELETE') {
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        writeSessionNotFound(res);
        return;
      }
      sessions.delete(sessionId as string);
      await session.transport.close();
      res.writeHead(204).end();
      return;
    }

    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (sessionId && !session) {
      writeSessionNotFound(res);
      return;
    }

    if (!session) {
      const server = createVisualDirectorServer(options, registry);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (initializedSessionId) => {
          if (newlyCreatedSession) sessions.set(initializedSessionId, newlyCreatedSession);
        },
        onsessionclosed: (closedSessionId) => {
          if (closedSessionId) sessions.delete(closedSessionId);
        },
      });
      transport.onerror = (error) => {
        logToStderr('MCP transport error', error);
      };
      newlyCreatedSession = { server, transport };
      session = newlyCreatedSession;
      transport.onclose = () => {
        const currentId = transport.sessionId;
        if (currentId) sessions.delete(currentId);
      };
      await server.connect(transport);
      connected = true;
    }

    await session.transport.handleRequest(req, res);
    const assignedId = session.transport.sessionId;
    if (assignedId) sessions.set(assignedId, session);
  } catch (error) {
    logToStderr('HTTP request lifecycle error', error);
    if (newlyCreatedSession && (!connected || newlyCreatedSession.transport.sessionId === undefined)) {
      await closeTransportAfterConnectionFailure(newlyCreatedSession.transport);
    }
    throw error;
  }
}

async function closeTransportAfterConnectionFailure(transport: { close: () => Promise<void> }): Promise<void> {
  try {
    await transport.close();
  } catch (error) {
    logToStderr('transport cleanup failed', error);
  }
}

function writeHttpRequestError(res: ServerResponse, error: unknown): void {
  if (res.headersSent || res.writableEnded) {
    if (!res.destroyed) res.destroy(error instanceof Error ? error : undefined);
    return;
  }

  writeJson(res, 500, {
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32603,
      message: 'Internal transport error while handling the MCP request.',
      data: serializeError(error),
    },
  });
}

function writeSessionNotFound(res: ServerResponse): void {
  writeJson(res, 404, {
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32001,
      message: 'MCP session not found. Reinitialize the connection; Canon state has not been evaluated.',
    },
  });
}

function logToStderr(scope: string, error: unknown): void {
  process.stderr.write(`[visual-director] ${scope}: ${JSON.stringify(serializeError(error))}\n`);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function writeJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

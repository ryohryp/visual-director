import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { VisualDirectorError } from '../domain/types.js';
import type { PrepareGenerationInput } from '../domain/types.js';
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
  const server = new McpServer(
    { name: 'visual-director', version: '0.1.0' },
    {
      instructions:
        'Visual Director is a fail-closed gate before image generation. For any Canon-governed game image, call visual.prepare_generation and proceed to an image model only after that exact request returns a successful Generation Package with non-empty style_lock and subject_lock. If preparation returns any error, do not call an image generator and do not reconstruct or guess character facts from assistant memory, conversation history, another character, a legacy asset, or a prior candidate. Fix the reported error and prepare again. When a known project needs a local repository path and the user explicitly provides that path, call visual.configure_project first. It validates and stores the path for this running MCP server only; it does not write the repository or persist across restart. Call visual.adopt_anchor only after the user explicitly approves the exact image, passing either the OpenAI candidate_file reference or the backward-compatible repository candidate_path; never infer approval, interpret /mnt/data as a local repository path, or replace a different Approved Anchor. If the client does not expose visual.configure_project because its tool catalog is stale, pass the explicit local clone path as scene_context.repository_path to visual.prepare_generation; the server uses it only to bootstrap the runtime binding and removes it before building the visual prompt. The bottom-of-thirst adapter safely normalizes configured character-name aliases and visual_anchor to character_visual_anchor, but unknown aliases are never fuzzy-matched. visual.prepare_generation validates the configured Visual Canon and never generates images or calls an image API. Report explicit errors and never invent a fallback package or substitute candidate or legacy assets.',
    },
  );
  server.registerTool(
    'visual.configure_project',
    {
      title: 'Configure project repository',
      description:
        'Bind a known project to an existing local repository directory for this running MCP server. This changes runtime memory only; it does not write the repository or persist across restart.',
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
        const configuration = await registry.configureProject(input.project_id, input.repository_path);
        return {
          structuredContent: { ...configuration } as Record<string, unknown>,
          content: [{ type: 'text' as const, text: JSON.stringify(configuration, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(serializeError(error), null, 2) }],
        };
      }
    },
  );
  server.registerTool(
    'visual.adopt_anchor',
    {
      title: 'Adopt Anchor and register Canon',
      description:
        'After explicit user approval, adopt one image as the subject Approved Visual Anchor. candidate_file accepts the ChatGPT/OpenAI file reference supplied by the host and stores it at the subject-defined v2 Anchor path; candidate_path remains the repository-relative compatibility input. Refuses unknown subjects, unsafe paths, invalid images, and replacement of an existing Anchor.',
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
        const result = await registry.adoptAnchor(input);
        return {
          structuredContent: { ...result } as Record<string, unknown>,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(serializeError(error), null, 2) }] };
      }
    },
  );
  server.registerTool(
    'visual.prepare_generation',
    {
      title: 'Prepare visual generation',
      description:
        'Read the configured project Visual Canon and return the required fail-closed Generation Package for an image model. A failed preparation must not be bypassed with a hand-written fallback prompt. If visual.configure_project is unavailable in a stale client catalog, an explicitly supplied scene_context.repository_path can bootstrap the runtime repository binding and is stripped before prompt construction. This tool never generates images or calls an image API.',
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
        const preparationInput = await bootstrapRepositoryFromSceneContext(registry, input);
        const adapter = registry.resolve(input.project_id);
        const generationPackage = await adapter.prepare(preparationInput);
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

async function bootstrapRepositoryFromSceneContext(
  registry: ReturnType<typeof createProjectRegistry>,
  input: PrepareGenerationInput,
): Promise<PrepareGenerationInput> {
  const sceneContext = input.scene_context;
  if (!sceneContext || !Object.prototype.hasOwnProperty.call(sceneContext, 'repository_path')) {
    return input;
  }

  const repositoryPath = sceneContext.repository_path;
  if (typeof repositoryPath !== 'string' || !repositoryPath.trim()) {
    throw new VisualDirectorError(
      'PROJECT_CONFIG_INVALID',
      'scene_context.repository_path must be a non-empty string when used to bootstrap the runtime project binding.',
      { project_id: input.project_id },
    );
  }

  await registry.configureProject(input.project_id, repositoryPath);
  const cleanedSceneContext = { ...sceneContext };
  delete cleanedSceneContext.repository_path;
  const inputWithoutSceneContext = { ...input };
  delete inputWithoutSceneContext.scene_context;
  return Object.keys(cleanedSceneContext).length > 0
    ? { ...inputWithoutSceneContext, scene_context: cleanedSceneContext }
    : inputWithoutSceneContext;
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
      message: 'Internal error while handling the MCP request.',
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
      message: 'Session not found. Reinitialize the MCP connection.',
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

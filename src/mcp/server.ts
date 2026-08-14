import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { VisualDirectorError } from '../domain/types.js';
import type { PrepareGenerationInput } from '../domain/types.js';
import { createProjectRegistry } from '../projects/registry.js';

export interface VisualDirectorServerOptions {
  repoPath?: string;
  projectsConfigPath?: string;
}

export function createVisualDirectorServer(options: VisualDirectorServerOptions = {}): McpServer {
  const registry = createProjectRegistry(options);
  const server = new McpServer(
    { name: 'visual-director', version: '0.1.0' },
    {
      instructions:
        'Visual Director is a fail-closed gate before image generation. For any Canon-governed game image, call visual.prepare_generation and proceed to an image model only after that exact request returns a successful Generation Package with non-empty style_lock and subject_lock. If preparation returns any error, do not call an image generator and do not reconstruct or guess character facts from assistant memory, conversation history, another character, a legacy asset, or a prior candidate. Fix the reported error and prepare again. When a known project needs a local repository path and the user explicitly provides that path, call visual.configure_project first. It validates and stores the path for this running MCP server only; it does not write the repository or persist across restart. If the client does not expose visual.configure_project because its tool catalog is stale, pass the explicit local clone path as scene_context.repository_path to visual.prepare_generation; the server uses it only to bootstrap the runtime binding and removes it before building the visual prompt. The bottom-of-thirst adapter safely normalizes configured character-name aliases and visual_anchor to character_visual_anchor, but unknown aliases are never fuzzy-matched. visual.prepare_generation validates the configured Visual Canon and never generates images or calls an image API. Report explicit errors and never invent a fallback package or substitute candidate or legacy assets.',
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
        schema_version: z.number(),
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
        fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
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

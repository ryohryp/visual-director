import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

import { createVisualDirectorServer } from '../src/mcp/server.js';

const originalHostedMode = process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY;

afterEach(() => {
  if (originalHostedMode === undefined) {
    delete process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY;
  } else {
    process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY = originalHostedMode;
  }
});

describe('hosted non-character MCP entrypoint', () => {
  it('publishes a subjectless schema under a distinct tool name', async () => {
    process.env.VISUAL_DIRECTOR_HOSTED_READ_ONLY = '1';
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createVisualDirectorServer();
    const client = new Client({ name: 'non-character-schema-test', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((candidate) => candidate.name === 'visual.prepare_non_character_generation');
      expect(tool).toBeDefined();
      expect(tool).toMatchObject({
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      });

      const inputSchema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      } | undefined;
      expect(inputSchema?.properties).not.toHaveProperty('subject_ids');
      expect(inputSchema?.required ?? []).not.toContain('subject_ids');
      expect(inputSchema?.required ?? []).toEqual(expect.arrayContaining([
        'project_id',
        'asset_type',
        'request_text',
      ]));
      expect(tools.tools.map((candidate) => candidate.name)).not.toContain('visual.generate_image');
      expect(client.getInstructions()).toContain('visual.prepare_non_character_generation');
    } finally {
      await client.close();
      await server.close();
    }
  });
});

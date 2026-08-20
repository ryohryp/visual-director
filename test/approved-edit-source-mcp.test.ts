import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { registerApprovedEditSourceTool } from '../src/mcp/approved-edit-source.js';
import { createVisualDirectorServer } from '../src/mcp/server.js';

describe('approved edit source MCP tool', () => {
  it('publishes an explicit OpenAI file binding parameter and fail-closed policy', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createVisualDirectorServer({ enableGenerationTool: false });
    registerApprovedEditSourceTool(server);
    const client = new Client({ name: 'approved-edit-source-schema-test', version: '0.1.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((candidate) => candidate.name === 'visual.bind_approved_edit_source');
      expect(tool).toBeDefined();
      expect(tool).toMatchObject({
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
        _meta: {
          'openai/fileParams': ['approved_source_file'],
        },
      });

      const inputSchema = tool?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      } | undefined;
      expect(inputSchema?.required ?? []).toEqual(expect.arrayContaining([
        'project_id',
        'candidate_manifest_path',
        'approved_source_file',
      ]));
      expect(inputSchema?.properties).toHaveProperty('approved_source_file');
      expect(tool?.description).toContain('sole edit target');
    } finally {
      await client.close();
      await server.close();
    }
  });
});

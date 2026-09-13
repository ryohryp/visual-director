import { describe, expect, it } from 'vitest';

import {
  CHATGPT_EXPECTED_HOSTED_TOOLS,
  createChatGptConnectionInfo,
} from '../src/mcp/chatgpt-connection.js';

describe('createChatGptConnectionInfo', () => {
  it('publishes the stable hosted MCP connection contract', () => {
    const info = createChatGptConnectionInfo('https://visual-director.example/');

    expect(info).toEqual({
      service: 'visual-director',
      display_name: 'Visual Director',
      mode: 'hosted-read-only',
      transport: {
        type: 'streamable-http',
        endpoint: 'https://visual-director.example/mcp',
        method: 'POST',
        stateless: true,
      },
      health_url: 'https://visual-director.example/health',
      expected_tools: CHATGPT_EXPECTED_HOSTED_TOOLS,
      usage: {
        primary_prepare_tool: 'visual.prepare_generation',
        non_character_prepare_tool: 'visual.prepare_non_character_generation',
        hosted_generation_available: false,
        context_isolation_required: true,
      },
    });
  });

  it('advertises the normal-chat preparation tools without hosted generation', () => {
    const info = createChatGptConnectionInfo('https://visual-director.example');

    expect(info.expected_tools).toContain('visual.prepare_generation');
    expect(info.expected_tools).toContain('visual.prepare_non_character_generation');
    expect(info.usage.hosted_generation_available).toBe(false);
    expect(info.usage.context_isolation_required).toBe(true);
  });
});

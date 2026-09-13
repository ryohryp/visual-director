export const CHATGPT_EXPECTED_HOSTED_TOOLS = [
  'visual.configure_project',
  'visual.adopt_anchor',
  'visual.prepare_generation',
  'visual.prepare_non_character_generation',
  'visual.bind_approved_edit_source',
] as const;

export interface ChatGptConnectionInfo {
  service: 'visual-director';
  display_name: 'Visual Director';
  mode: 'hosted-read-only';
  transport: {
    type: 'streamable-http';
    endpoint: string;
    method: 'POST';
    stateless: true;
  };
  health_url: string;
  expected_tools: readonly string[];
  usage: {
    primary_prepare_tool: 'visual.prepare_generation';
    non_character_prepare_tool: 'visual.prepare_non_character_generation';
    hosted_generation_available: false;
    context_isolation_required: true;
  };
}

export function createChatGptConnectionInfo(origin: string): ChatGptConnectionInfo {
  const normalizedOrigin = origin.replace(/\/$/, '');
  return {
    service: 'visual-director',
    display_name: 'Visual Director',
    mode: 'hosted-read-only',
    transport: {
      type: 'streamable-http',
      endpoint: `${normalizedOrigin}/mcp`,
      method: 'POST',
      stateless: true,
    },
    health_url: `${normalizedOrigin}/health`,
    expected_tools: CHATGPT_EXPECTED_HOSTED_TOOLS,
    usage: {
      primary_prepare_tool: 'visual.prepare_generation',
      non_character_prepare_tool: 'visual.prepare_non_character_generation',
      hosted_generation_available: false,
      context_isolation_required: true,
    },
  };
}

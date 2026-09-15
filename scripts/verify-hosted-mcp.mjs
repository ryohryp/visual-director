import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const DEFAULT_ENDPOINT = 'https://visual-director-beta.vercel.app/mcp';
const EXPECTED_SUBJECT_ID = 'fixture_subject';
const EXPECTED_GLOBAL_REFERENCE = 'docs/visual/assets/global-reference.png';
const EXPECTED_SUBJECT_ANCHOR = 'docs/visual/assets/fixture-subject-anchor.png';

const endpoint = new URL(process.argv[2] ?? process.env.VISUAL_DIRECTOR_MCP_URL ?? DEFAULT_ENDPOINT);
const allowHttp = process.env.VISUAL_DIRECTOR_ALLOW_INSECURE_HTTP === '1';

if (endpoint.pathname !== '/mcp') {
  fail('The Hosted MCP URL must end with /mcp.');
}
if (endpoint.protocol !== 'https:' && !allowHttp) {
  fail('Refusing a non-HTTPS Hosted MCP URL. Set VISUAL_DIRECTOR_ALLOW_INSECURE_HTTP=1 only for local verification.');
}

const healthUrl = new URL('/health', endpoint);
const health = await fetchJson(healthUrl, { method: 'GET' });
if (health.response.status !== 200 || health.body?.status !== 'ok' || health.body?.mode !== 'hosted-read-only') {
  fail(`Health check failed with HTTP ${health.response.status}.`);
}
console.log('health: ok (hosted-read-only)');

const connectionUrl = new URL('/api/connection-info', endpoint);
const connection = await fetchJson(connectionUrl, { method: 'GET' });
if (connection.response.status !== 200) {
  fail(`Connection info failed with HTTP ${connection.response.status}.`);
}
if (connection.body?.service !== 'visual-director'
  || connection.body?.display_name !== 'Visual Director'
  || connection.body?.transport?.endpoint !== endpoint.toString()
  || connection.body?.transport?.type !== 'streamable-http'
  || connection.body?.transport?.stateless !== true
  || connection.body?.usage?.primary_prepare_tool !== 'visual.prepare_generation'
  || connection.body?.usage?.hosted_generation_available !== false) {
  fail('Connection info does not match the hosted ChatGPT contract.');
}
if (!Array.isArray(connection.body?.expected_tools)
  || !connection.body.expected_tools.includes('visual.prepare_generation')) {
  fail('Connection info does not advertise visual.prepare_generation.');
}
console.log('connection-info: ok (ChatGPT hosted contract)');

await verifyEra('legacy', { mode: 'legacy' });
await verifyEra('modern-2026-07-28', { mode: { pin: '2026-07-28' } });
console.log('Hosted Visual Director E2E passed.');

async function verifyEra(label, versionNegotiation) {
  const transport = new StreamableHTTPClientTransport(endpoint);
  const client = new Client(
    { name: `visual-director-hosted-e2e-${label}`, version: '1.0.0' },
    { versionNegotiation },
  );

  try {
    await client.connect(transport);
    const expectedEra = label === 'legacy' ? 'legacy' : 'modern';
    if (client.getProtocolEra() !== expectedEra) {
      fail(`${label}: negotiated unexpected protocol era ${client.getProtocolEra() ?? 'unknown'}.`);
    }
    if (transport.sessionId !== undefined) {
      fail(`${label}: hosted transport unexpectedly created an MCP session id.`);
    }

    const tools = await client.listTools();
    if (!Array.isArray(tools.tools) || !tools.tools.some((tool) => tool?.name === 'visual.prepare_generation')) {
      fail(`${label}: tools/list did not expose visual.prepare_generation.`);
    }

    const prepared = await client.callTool({
      name: 'visual.prepare_generation',
      arguments: {
        project_id: 'hosted-e2e-fixture',
        asset_type: 'character_visual_anchor',
        subject_ids: [EXPECTED_SUBJECT_ID],
        request_text: 'Visual Director-owned fixture の Approved Visual Anchor を正本として Generation Package を取得する。画像生成は行わない。',
      },
    });
    if (prepared.isError === true) {
      fail(`${label}: visual.prepare_generation returned an MCP tool error: ${describeToolError(prepared)}`);
    }

    const packageResult = prepared.structuredContent;
    if (packageResult?.project_id !== 'hosted-e2e-fixture') {
      fail(`${label}: visual.prepare_generation returned an unexpected project.`);
    }
    const grandDesignLock = packageResult?.prompt_package?.grand_design_lock;
    if (typeof grandDesignLock !== 'string' || grandDesignLock.trim() === '') {
      fail(`${label}: visual.prepare_generation did not return grand_design_lock.`);
    }
    let grandDesign;
    try {
      grandDesign = JSON.parse(grandDesignLock);
    } catch {
      fail(`${label}: grand_design_lock is not valid JSON.`);
    }
    if (grandDesign?.project_id !== 'hosted-e2e-fixture' || grandDesign?.schema_version !== 1) {
      fail(`${label}: grand_design_lock does not match the Hosted E2E Fixture Grand Design.`);
    }
    if (typeof packageResult?.prompt_package?.style_lock !== 'string' || packageResult.prompt_package.style_lock.trim() === '') {
      fail(`${label}: visual.prepare_generation did not preserve style_lock.`);
    }
    if (!Array.isArray(packageResult?.prompt_package?.subject_lock)
      || !packageResult.prompt_package.subject_lock.some((lock) => typeof lock === 'string' && lock.includes(EXPECTED_SUBJECT_ID))) {
      fail(`${label}: visual.prepare_generation did not preserve the Fixture subject_lock.`);
    }
    if (packageResult?.policy?.must_use_approved_anchor !== true) {
      fail(`${label}: visual.prepare_generation did not require the Approved Anchor.`);
    }
    if (packageResult?.policy?.must_not_chain_from_candidate !== true) {
      fail(`${label}: visual.prepare_generation did not forbid Candidate chaining.`);
    }
    if (!Array.isArray(packageResult.reference_assets) || !packageResult.reference_assets.some((asset) => (
      asset?.role === 'global_reference'
      && asset?.path === EXPECTED_GLOBAL_REFERENCE
    ))) {
      fail(`${label}: visual.prepare_generation did not return the global_reference.`);
    }
    if (!packageResult.reference_assets.some((asset) => (
      asset?.role === 'subject_anchor'
      && asset?.subject_id === EXPECTED_SUBJECT_ID
      && asset?.path === EXPECTED_SUBJECT_ANCHOR
    ))) {
      fail(`${label}: visual.prepare_generation did not return the expected Fixture Subject subject_anchor.`);
    }

    console.log(`${label}: ok (tools=${tools.tools.length}, anchor=${EXPECTED_SUBJECT_ANCHOR}, grand-design=v${grandDesign.schema_version})`);
  } catch (error) {
    if (process.exitCode === 1) throw error;
    fail(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function describeToolError(result) {
  const text = Array.isArray(result.content)
    ? result.content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join(' | ')
    : '';
  if (text) return text;
  if (result.structuredContent !== undefined) {
    try {
      return JSON.stringify(result.structuredContent);
    } catch {
      return '[unserializable structuredContent]';
    }
  }
  return '[no error detail returned]';
}

async function fetchJson(url, init) {
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    fail(`Request failed before receiving an HTTP response: ${url.pathname}.`);
  }

  const text = await response.text();
  if (text.trim() === '') return { response, body: undefined };
  try {
    return { response, body: JSON.parse(text) };
  } catch {
    fail(`Expected JSON from ${url.pathname}, received HTTP ${response.status}.`);
  }
}

function fail(message) {
  console.error(`Hosted E2E failed: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

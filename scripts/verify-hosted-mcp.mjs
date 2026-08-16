import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const DEFAULT_ENDPOINT = 'https://visual-director-beta.vercel.app/mcp';
const EXPECTED_GLOBAL_REFERENCE = 'docs/visual/assets/global_visual_style_reference.webp';
const EXPECTED_SUBJECT_ANCHOR = 'public/images/characters/kamino_kyosuke/v2/default.avif';

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
        project_id: 'bottom-of-thirst',
        asset_type: 'character_visual_anchor',
        subject_ids: ['kamino_kyosuke'],
        request_text: '神野恭介のApproved Visual Anchorを正本としてGeneration Packageを取得する。画像生成は行わない。',
      },
    });
    if (prepared.isError === true) {
      fail(`${label}: visual.prepare_generation returned an MCP tool error.`);
    }

    const packageResult = prepared.structuredContent;
    if (packageResult?.project_id !== 'bottom-of-thirst') {
      fail(`${label}: visual.prepare_generation returned an unexpected project.`);
    }
    if (packageResult?.policy?.must_use_approved_anchor !== true) {
      fail(`${label}: visual.prepare_generation did not require the Approved Anchor.`);
    }
    if (!Array.isArray(packageResult.reference_assets) || !packageResult.reference_assets.some((asset) => (
      asset?.role === 'global_reference'
      && asset?.path === EXPECTED_GLOBAL_REFERENCE
    ))) {
      fail(`${label}: visual.prepare_generation did not return the global_reference.`);
    }
    if (!packageResult.reference_assets.some((asset) => (
      asset?.role === 'subject_anchor'
      && asset?.subject_id === 'kamino_kyosuke'
      && asset?.path === EXPECTED_SUBJECT_ANCHOR
    ))) {
      fail(`${label}: visual.prepare_generation did not return the expected Kamino subject_anchor.`);
    }

    console.log(`${label}: ok (tools=${tools.tools.length}, anchor=${EXPECTED_SUBJECT_ANCHOR})`);
  } catch (error) {
    if (process.exitCode === 1) throw error;
    fail(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await client.close().catch(() => undefined);
  }
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

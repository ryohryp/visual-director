const DEFAULT_ENDPOINT = 'https://visual-director-beta.vercel.app/mcp';
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

const initialize = await postMcp(endpoint, {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'visual-director-hosted-e2e', version: '1.0.0' },
  },
});
assertRpcSuccess(initialize, 'MCP initialize');
console.log('mcp: initialize ok');

await postMcp(endpoint, {
  jsonrpc: '2.0',
  method: 'notifications/initialized',
  params: {},
}, { allowEmpty: true });

const toolsList = await postMcp(endpoint, {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {},
});
assertRpcSuccess(toolsList, 'MCP tools/list');
const tools = toolsList.result?.tools;
if (!Array.isArray(tools) || !tools.some((tool) => tool?.name === 'visual.prepare_generation')) {
  fail('MCP tools/list did not expose visual.prepare_generation.');
}
console.log(`mcp: tools/list ok (${tools.length} tools)`);

const prepared = await postMcp(endpoint, {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: {
    name: 'visual.prepare_generation',
    arguments: {
      project_id: 'bottom-of-thirst',
      asset_type: 'character_visual_anchor',
      subject_ids: ['kamino_kyosuke'],
      request_text: '神野恭介のApproved Visual Anchorを正本としてGeneration Packageを取得する。画像生成は行わない。',
    },
  },
});
assertRpcSuccess(prepared, 'visual.prepare_generation');

const packageResult = prepared.result?.structuredContent;
if (packageResult?.project_id !== 'bottom-of-thirst') {
  fail('visual.prepare_generation returned an unexpected project.');
}
if (packageResult?.policy?.must_use_approved_anchor !== true) {
  fail('visual.prepare_generation did not require the Approved Anchor.');
}
if (!Array.isArray(packageResult.reference_assets) || !packageResult.reference_assets.some((asset) => (
  asset?.role === 'subject_anchor'
  && asset?.subject_id === 'kamino_kyosuke'
  && asset?.path === EXPECTED_SUBJECT_ANCHOR
))) {
  fail('visual.prepare_generation did not return the expected Kamino subject_anchor.');
}

console.log(`prepare_generation: ok (anchor=${EXPECTED_SUBJECT_ANCHOR}, must_use_approved_anchor=true)`);
console.log('Hosted Visual Director E2E passed.');

async function postMcp(url, body, options = {}) {
  const result = await fetchJson(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify(body),
  });
  if (!options.allowEmpty && result.body === undefined) {
    fail(`MCP request ${body.method} returned an empty response.`);
  }
  if (result.response.status < 200 || result.response.status >= 300) {
    fail(`MCP request ${body.method} failed with HTTP ${result.response.status}.`);
  }
  return result.body ?? {};
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

function assertRpcSuccess(response, operation) {
  if (response.error) {
    fail(`${operation} returned JSON-RPC error ${response.error.code ?? 'unknown'}.`);
  }
  if (!response.result) {
    fail(`${operation} returned no JSON-RPC result.`);
  }
  if (response.result?.isError === true) {
    fail(`${operation} returned an MCP tool error.`);
  }
}

function fail(message) {
  console.error(`Hosted E2E failed: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

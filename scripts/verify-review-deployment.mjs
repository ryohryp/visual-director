const reviewUrl = new URL(process.env.VISUAL_DIRECTOR_REVIEW_URL ?? 'https://visual-director-beta.vercel.app');
const expectedRevision = process.env.EXPECTED_REVISION?.trim();
const projectId = process.env.VISUAL_DIRECTOR_SMOKE_PROJECT_ID?.trim() || 'bottom-of-thirst';
const timeoutMs = Number(process.env.VISUAL_DIRECTOR_SMOKE_TIMEOUT_MS ?? 15000);

function fail(message) {
  throw new Error(message);
}

async function request(path) {
  const url = new URL(path, reviewUrl);
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'follow',
    headers: { 'user-agent': 'visual-director-review-smoke/1' },
    signal: globalThis.AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) fail(`${path} returned HTTP ${response.status} (${response.url})`);
  return response;
}

async function json(path) {
  const response = await request(path);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) fail(`${path} did not return JSON (${contentType || 'no content-type'})`);
  return response.json();
}

async function html(path, markers) {
  const response = await request(path);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) fail(`${path} did not return Visual Director HTML (${contentType || 'no content-type'})`);
  const body = await response.text();
  for (const marker of markers) {
    if (!body.includes(marker)) fail(`${path} is missing expected Visual Director marker: ${marker}`);
  }
  return body;
}

const deployment = await json('/api/deployment');
if (deployment.app !== 'visual-director') fail('/api/deployment does not identify the Visual Director app');
if (!deployment.revision || deployment.revision === 'unknown') fail('/api/deployment does not expose a usable revision');
if (expectedRevision && deployment.revision !== expectedRevision) {
  fail(`stale or wrong deployment: expected ${expectedRevision}, served ${deployment.revision}`);
}

const revisionMarker = `data-deployment-revision="${deployment.revision}"`;
await html('/', ['<title>Visual Director · Projects</title>', revisionMarker]);

const projects = await json('/api/projects');
if (!Array.isArray(projects.projects)) fail('/api/projects is missing projects[]');
if (!projects.projects.some((project) => project.project_id === projectId)) fail(`/api/projects does not include ${projectId}`);

const encodedProject = encodeURIComponent(projectId);
const overview = await json(`/api/projects/${encodedProject}/overview`);
if (overview.project_id !== projectId) fail(`overview project_id mismatch: expected ${projectId}`);
if (!Array.isArray(overview.approved_anchors)) fail('overview is missing approved_anchors[]');
if (!overview.workflow || !Array.isArray(overview.workflow.assets) || !Array.isArray(overview.workflow.jobs)) {
  fail('overview workflow contract is missing assets[] or jobs[]');
}

await html(`/projects/${encodedProject}`, ['<title>Project · Visual Director</title>', 'Project workspace', revisionMarker]);
await html(`/projects/${encodedProject}/canon`, ['<title>Global Visual Canon · Visual Director</title>', 'Project workspace', revisionMarker]);
for (const route of ['anchors', 'assets', 'generations']) {
  await html(`/projects/${encodedProject}/${route}`, ['<title>Project workflow · Visual Director</title>', 'Project workspace', revisionMarker]);
}

console.log(`Review deployment verified: ${reviewUrl.origin} @ ${deployment.revision} (${deployment.branch})`);

export type DeploymentInfo = {
  app: 'visual-director';
  revision: string;
  branch: string;
  build_time: string | null;
  deployment_id: string | null;
  deployment_url: string | null;
};

const UNKNOWN_REVISION = 'unknown';

export function getDeploymentInfo(env: NodeJS.ProcessEnv = process.env): DeploymentInfo {
  const revision = first(env.VISUAL_DIRECTOR_BUILD_SHA, env.VERCEL_GIT_COMMIT_SHA, env.GITHUB_SHA) ?? UNKNOWN_REVISION;
  const branch = first(env.VISUAL_DIRECTOR_BUILD_REF, env.VERCEL_GIT_COMMIT_REF, env.GITHUB_REF_NAME) ?? 'local';
  const buildTime = first(env.VISUAL_DIRECTOR_BUILD_TIME) ?? null;
  const deploymentId = first(env.VERCEL_DEPLOYMENT_ID) ?? null;
  const deploymentUrl = normalizeUrl(first(env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL));

  return {
    app: 'visual-director',
    revision,
    branch,
    build_time: buildTime,
    deployment_id: deploymentId,
    deployment_url: deploymentUrl,
  };
}

export const DEPLOYMENT_META_STYLES = '.deployment-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:18px 0 0;padding-top:12px;border-top:1px solid #26323e;color:#738294;font-size:10px}.deployment-meta code{color:#9fb0c2;font:10px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.deployment-meta a{color:#8fa4ba;text-decoration:none}.deployment-meta a:hover{text-decoration:underline}';

export function deploymentMetaMarkup(info: DeploymentInfo = getDeploymentInfo()): string {
  const revision = escapeHtml(info.revision);
  const shortRevision = escapeHtml(info.revision === UNKNOWN_REVISION ? UNKNOWN_REVISION : info.revision.slice(0, 12));
  const branch = escapeHtml(info.branch);
  const buildTime = escapeHtml(info.build_time ?? 'build time unavailable');

  return `<aside class="deployment-meta" aria-label="Deployment information" data-deployment-revision="${revision}" data-deployment-branch="${branch}"><span>Build <code title="${revision}">${shortRevision}</code></span><span>·</span><span>${branch}</span><span>·</span><span>${buildTime}</span><span>·</span><a href="/api/deployment">deployment info</a></aside>`;
}

function first(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function normalizeUrl(value: string | undefined): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

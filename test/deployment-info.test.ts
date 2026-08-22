import { describe, expect, it } from 'vitest';

import { deploymentMetaMarkup, getDeploymentInfo } from '../src/web/deployment-info.js';

describe('deployment diagnostics', () => {
  it('prefers explicit review build metadata and only exposes whitelisted fields', () => {
    const info = getDeploymentInfo({
      VISUAL_DIRECTOR_BUILD_SHA: '0123456789abcdef',
      VISUAL_DIRECTOR_BUILD_REF: 'main',
      VISUAL_DIRECTOR_BUILD_TIME: '2026-08-22T15:00:00Z',
      VERCEL_GIT_COMMIT_SHA: 'fallback-sha',
      VERCEL_DEPLOYMENT_ID: 'dpl_test',
      VERCEL_PROJECT_PRODUCTION_URL: 'visual-director-beta.vercel.app',
      SECRET_TOKEN: 'must-not-leak',
    });

    expect(info).toEqual({
      app: 'visual-director',
      revision: '0123456789abcdef',
      branch: 'main',
      build_time: '2026-08-22T15:00:00Z',
      deployment_id: 'dpl_test',
      deployment_url: 'https://visual-director-beta.vercel.app',
    });
    expect(JSON.stringify(info)).not.toContain('must-not-leak');
  });

  it('falls back to Vercel git metadata and renders a comparable revision marker', () => {
    const info = getDeploymentInfo({
      VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890',
      VERCEL_GIT_COMMIT_REF: 'main',
    });
    const markup = deploymentMetaMarkup(info);

    expect(info.revision).toBe('abcdef1234567890');
    expect(markup).toContain('data-deployment-revision="abcdef1234567890"');
    expect(markup).toContain('<code title="abcdef1234567890">abcdef123456</code>');
    expect(markup).toContain('build time unavailable');
  });

  it('escapes deployment metadata before rendering it into HTML', () => {
    const markup = deploymentMetaMarkup({
      app: 'visual-director',
      revision: '<sha>',
      branch: 'main" onclick="alert(1)',
      build_time: null,
      deployment_id: null,
      deployment_url: null,
    });

    expect(markup).toContain('data-deployment-revision="&lt;sha&gt;"');
    expect(markup).not.toContain('onclick="alert(1)"');
  });
});

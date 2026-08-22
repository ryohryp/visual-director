import type { IncomingMessage, ServerResponse } from 'node:http';

import { getDeploymentInfo } from '../src/web/deployment-info.js';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET');
    res.end();
    return;
  }

  const info = getDeploymentInfo();
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-visual-director-revision', info.revision);
  res.end(JSON.stringify(info));
}

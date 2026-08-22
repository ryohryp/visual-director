import type { IncomingMessage, ServerResponse } from 'node:http';

import { homeHandler } from '../src/web/home.js';
import { projectCollectionHandler } from '../src/web/project-collection.js';
import {
  projectAnchorDetailHandler,
  projectCanonHandler,
  projectDashboardHandler,
} from '../src/web/project-pages.js';

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/api/workspace', 'https://visual-director.local');
  const view = url.searchParams.get('view');
  if (view === 'home') return homeHandler(req, res);
  if (view === 'project') return projectDashboardHandler(req, res);
  if (view === 'canon') return projectCanonHandler(req, res);
  if (view === 'collection') return projectCollectionHandler(req, res);
  if (view === 'anchor') return projectAnchorDetailHandler(req, res);
  res.statusCode = 404;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end('Unknown workspace view.');
}

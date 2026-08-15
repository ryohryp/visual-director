import type { IncomingMessage, ServerResponse } from 'node:http';

import { writeHealthResponse } from '../src/mcp/hosted-server.js';

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  writeHealthResponse(res);
}

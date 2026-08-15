import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleHostedMcpRequest } from '../src/mcp/hosted-server.js';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleHostedMcpRequest(req, res);
}

import { createHttpServerForVisualDirector, runStdio } from './mcp/server.js';

const isHttp = process.argv.includes('--http');
const repoPath = argumentValue('--repo-path') ?? process.env.BOTTOM_OF_THIRST_REPO_PATH;

if (isHttp) {
  const port = Number(argumentValue('--port') ?? process.env.VISUAL_DIRECTOR_PORT ?? 3000);
  const host = argumentValue('--host') ?? process.env.VISUAL_DIRECTOR_HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${port}`);
  }
  const { httpServer } = createHttpServerForVisualDirector({ repoPath });
  httpServer.listen(port, host, () => {
    process.stderr.write(`Visual Director MCP listening on http://${host}:${port}/mcp\n`);
  });
} else {
  await runStdio({ repoPath });
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value?.trim() || undefined;
}

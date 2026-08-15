import { createHostedHttpServerForVisualDirector } from './mcp/hosted-server.js';
import { createHttpServerForVisualDirector, runStdio } from './mcp/server.js';

const isVercel = process.env.VERCEL === '1';
const isHttp = process.argv.includes('--http') || isVercel;
const repoPath = argumentValue('--repo-path') ?? process.env.BOTTOM_OF_THIRST_REPO_PATH;
const projectsConfigPath = argumentValue('--projects-config') ?? process.env.VISUAL_DIRECTOR_PROJECTS_CONFIG;

if (isHttp) {
  const port = Number(argumentValue('--port') ?? process.env.PORT ?? process.env.VISUAL_DIRECTOR_PORT ?? 3000);
  const host = argumentValue('--host') ?? process.env.VISUAL_DIRECTOR_HOST ?? (isVercel ? '0.0.0.0' : '127.0.0.1');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${port}`);
  }
  const httpServer = isVercel
    ? createHostedHttpServerForVisualDirector({ repoPath, projectsConfigPath })
    : createHttpServerForVisualDirector({ repoPath, projectsConfigPath }).httpServer;
  httpServer.listen(port, host, () => {
    process.stderr.write(`Visual Director MCP listening on http://${host}:${port}/mcp\n`);
  });
} else {
  await runStdio({ repoPath, projectsConfigPath });
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value?.trim() || undefined;
}

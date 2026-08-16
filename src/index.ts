import path from 'node:path';

import { compileRepositoryCanon, COMPILED_CANON_RELATIVE_PATH } from './compiled-canon.js';
import { createHostedHttpServerForVisualDirector } from './mcp/hosted-server.js';
import { createHttpServerForVisualDirector, runStdio } from './mcp/server.js';
import { adoptRepositoryAnchor } from './repository-anchor-adoption.js';

const command = process.argv[2];

if (command === 'compile') {
  const projectId = requiredArgument('--project-id');
  const repositoryPath = requiredArgument('--repo-path');
  const outputPath = argumentValue('--output');
  const check = process.argv.includes('--check');
  await compileRepositoryCanon({ projectId, repositoryPath, outputPath, check });
  const resolvedOutput = path.resolve(repositoryPath, outputPath ?? COMPILED_CANON_RELATIVE_PATH);
  process.stderr.write(check
    ? `Compiled Canon is current: ${resolvedOutput}\n`
    : `Compiled Canon written: ${resolvedOutput}\n`);
} else if (command === 'adopt-anchor') {
  const projectId = requiredArgument('--project-id');
  const repositoryPath = requiredArgument('--repo-path');
  const subjectId = requiredArgument('--subject-id');
  const candidatePath = requiredArgument('--candidate-path');
  const projectsConfigPath = argumentValue('--projects-config');
  if (!process.argv.includes('--approve')) {
    throw new Error('--approve is required for anchor adoption.');
  }

  const result = await adoptRepositoryAnchor({
    projectId,
    repositoryPath,
    subjectId,
    candidatePath,
    ...(projectsConfigPath ? { projectsConfigPath } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
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
}

function requiredArgument(name: string): string {
  const value = argumentValue(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value?.trim() || undefined;
}

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceDir = resolve('pages');
const targetDir = resolve('dist/diagnostics');
const indexPath = resolve(targetDir, 'index.html');

await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });

const revision = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7)
  ?? process.env.GITHUB_SHA?.slice(0, 7)
  ?? 'local';
const buildTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const html = await readFile(indexPath, 'utf8');
await writeFile(
  indexPath,
  html
    .replaceAll('__BUILD_REVISION__', revision)
    .replaceAll('__BUILD_TIME__', buildTime),
  'utf8',
);

import { readFile } from 'node:fs/promises';

import { VisualDirectorError } from './types.js';

export async function readUtf8File(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new VisualDirectorError('CANON_READ_FAILED', `Could not read ${label}.`, {
      path,
      reason,
    });
  }
}

export function section(markdown: string, heading: string): string {
  return headingBlock(markdown, heading, 2);
}

export function subsection(markdown: string, heading: string): string {
  return headingBlock(markdown, heading, 3);
}

function headingBlock(markdown: string, heading: string, level: number): string {
  const hashes = '#'.repeat(level);
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${hashes} ${heading}`);
  if (start < 0) return '';

  const relativeEnd = lines.slice(start + 1).findIndex((line) => {
    const headingMatch = line.match(/^(#{1,6})\s+/);
    return headingMatch !== null && (headingMatch[1]?.length ?? 0) <= level;
  });
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end).join('\n').trim();
}

export function bullets(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+?)\s*$/)?.[1])
    .filter((value): value is string => Boolean(value));
}

export function bulletsAfterLabel(markdown: string, label: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const labelIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed === `${label}:` || trimmed === `### ${label}`;
  });
  if (labelIndex < 0) return [];
  const collected: string[] = [];
  for (const line of lines.slice(labelIndex + 1)) {
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/)?.[1];
    if (bullet) {
      collected.push(bullet);
      continue;
    }
    if (collected.length > 0 && line.trim() !== '') break;
  }
  return collected;
}

export function fencedBlock(markdown: string, language: string): string {
  const marker = '`'.repeat(3);
  const match = markdown.match(new RegExp(`${marker}${language}\\s*([\\s\\S]*?)${marker}`));
  return match?.[1]?.trim() ?? '';
}

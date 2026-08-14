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
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => matchesHeading(line, heading, level));
  if (start < 0) return '';

  const relativeEnd = lines.slice(start + 1).findIndex((line) => {
    const headingMatch = line.match(/^(#{1,6})\s+/);
    return headingMatch !== null && (headingMatch[1]?.length ?? 0) <= level;
  });
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end).join('\n').trim();
}

function matchesHeading(line: string, heading: string, level: number): boolean {
  const hashes = '#'.repeat(level);
  const headingPattern = new RegExp(`^${escapeRegExp(hashes)}[ \\t]+${escapeRegExp(heading)}(?:[ \\t]+#+)?[ \\t]*$`);
  return headingPattern.test(line.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function bullets(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+?)\s*$/)?.[1])
    .filter((value): value is string => Boolean(value));
}

export function tableFacts(markdown: string): string[] {
  const facts: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;

    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => cleanMarkdownCell(cell));
    if (cells.length < 2) continue;
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;

    const [label, value] = cells;
    if (!label || !value) continue;
    if (label === '項目' && value === '内容') continue;
    facts.push(`${label}: ${value}`);
  }
  return facts;
}

function cleanMarkdownCell(value: string): string {
  return value
    .trim()
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function bulletsAfterLabel(markdown: string, label: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const labelIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed === `${label}:` || matchesHeading(line, label, 2) || matchesHeading(line, label, 3);
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

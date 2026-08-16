import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let fixtureRoot: string;

interface StdioResponse {
  id?: number;
  error?: unknown;
  result?: {
    structuredContent?: {
      policy?: Record<string, unknown>;
      reference_assets?: Array<Record<string, string>>;
      prompt_package?: { subject_lock?: string[] };
    };
  };
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-director-entrypoint-'));
  await createApprovedKaminoFixture(fixtureRoot);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('MCP stdio entrypoint lifecycle', () => {
  it('keeps one process alive and returns JSON-RPC responses for configure and prepare', async () => {
    const child = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
      cwd: path.resolve('.'),
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    const iterator = lines[Symbol.asyncIterator]();

    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'entrypoint-lifecycle-test', version: '0.1.0' },
        },
      })}\n`);
      expect((await readJsonLine(iterator)).id).toBe(1);

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'visual.configure_project',
          arguments: { project_id: 'bottom-of-thirst', repository_path: fixtureRoot },
        },
      })}\n`);
      const configured = await readJsonLine(iterator);
      expect(configured.id).toBe(2);
      expect(configured.error).toBeUndefined();

      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'visual.prepare_generation',
          arguments: {
            project_id: 'bottom-of-thirst',
            asset_type: 'character_visual_anchor',
            subject_ids: ['kamino_kyosuke'],
            request_text: '神野恭介の Approved Visual Anchor を最優先の視覚正本として Generation Package を取得する。画像生成は行わない。',
            scene_context: { repository_path: fixtureRoot },
          },
        },
      })}\n`);
      const prepared = await readJsonLine(iterator);
      expect(prepared.id).toBe(3);
      expect(prepared.error).toBeUndefined();
      expect(prepared.result?.structuredContent).toMatchObject({
        policy: {
          must_use_approved_anchor: true,
          must_not_chain_from_candidate: true,
        },
        reference_assets: [
          { role: 'global_reference', path: 'docs/visual/assets/global_visual_style_reference.webp' },
          { role: 'subject_anchor', subject_id: 'kamino_kyosuke', path: 'public/images/characters/kamino_kyosuke/v2/default.avif' },
        ],
      });
      const subjectLock = prepared.result?.structuredContent?.prompt_package?.subject_lock?.join('\n') ?? '';
      expect(subjectLock).toContain('Approved Visual Anchor');
      expect(subjectLock).toContain('顔立ち');
      expect(subjectLock).toContain('髪型');
      expect(subjectLock).toContain('体格');
      expect(subjectLock).toContain('24歳');
      expect(child.exitCode).toBeNull();
    } finally {
      lines.close();
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([once(child, 'exit'), delay(2_000)]);
      }
    }
  });
});

async function readJsonLine(iterator: AsyncIterator<string>): Promise<StdioResponse> {
  const line = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for an MCP response.')), 10_000);
    iterator.next().then((result) => {
      clearTimeout(timer);
      if (result.done) reject(new Error('MCP stdio ended before returning a response.'));
      else resolve(result.value);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return JSON.parse(line);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function createApprovedKaminoFixture(root: string): Promise<void> {
  const files: Record<string, string> = {
    '.visual-director/manifest.json': JSON.stringify({
      version: 1,
      project_id: 'bottom-of-thirst',
      labels: {
        allowedChangesHeading: '変更してよいもの',
        forbiddenChangesHeading: '変更してはいけないもの',
        commonRulesHeading: '共通ルール',
        acceptedConditionsHeading: '採用する視覚条件',
      },
      subjects: {
        kamino_kyosuke: {
          display_name: '神野 恭介',
          character_file: 'docs/characters/kyosuke.md',
          canon_heading: '神野 恭介',
          aliases: ['神野恭介', '神野', '恭介'],
        },
      },
    }),
    'docs/visual/GLOBAL_VISUAL_STYLE.md': '# Style\n\n## Global Visual Style Lock\n\n```text\nSTYLE LOCK\n```\n\n## Fixed Avoid Block\n\n```text\nAVOID: photorealism, anime\n```\n\n### 変更してよいもの\n- 表情\n\n### 変更してはいけないもの\n- 顔立ち\n- 年齢\n- 髪型\n- 体格\n- 通常服\n- 描画方式\n',
    'docs/visual/CHARACTER_VISUAL_CANON.md': '# Canon\n\n## 共通ルール\n- Always use an approved anchor.\n\n## 神野 恭介\n\n### Approved Visual Anchor\n- `public/images/characters/kamino_kyosuke/v2/default.avif`\n\n### 採用する視覚条件\n- 24歳の動画配信者\n- 顔立ち、髪型、体格、年代感、衣装、画風をAnchorに固定する\n',
    'docs/WORLD_DIRECTION.md': '# World\n\n- grounded and observational\n',
    'docs/characters/kyosuke.md': '# 神野 恭介\n\n- 24歳の動画配信者\n- ジンバルを使う\n',
    'docs/visual/assets/README.md': '# Assets\n',
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }
  for (const relativePath of [
    'docs/visual/assets/global_visual_style_reference.webp',
    'public/images/characters/kamino_kyosuke/v2/default.avif',
  ]) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from('fixture'));
  }
}

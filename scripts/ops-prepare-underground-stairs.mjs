import { writeFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = new URL('https://visual-director-beta.vercel.app/mcp');
const transport = new StreamableHTTPClientTransport(endpoint);
const client = new Client(
  { name: 'issue-131-underground-stairs-prepare', version: '1.0.0' },
  { versionNegotiation: { mode: { pin: '2026-07-28' } } },
);

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: 'visual.prepare_generation',
    arguments: {
      project_id: 'bottom-of-thirst',
      asset_type: 'background',
      subject_ids: [],
      request_text: '既存の地下階段の場所・視点・材質を維持したまま、11段目までは乾燥、12段目の中央だけ局所的に濡れ、13段目以降で濡れる境界へ修正する。漏水、苔、巨大な足跡、超常記号は追加しない。16:9と9:16のruntime cropでも12段目の境界が証拠として読めること。',
      scene_context: {
        reference_paths: ['public/images/backgrounds/underground_stairs.jpg'],
        canonical_facts: [
          '最初の11段は乾いている',
          '12段目の中央だけ黒く濡れている',
          '13段目以降で靴底が明確に濡れる',
          '壁と天井に漏水跡はない',
          '湿度はほぼ変わらない',
        ],
        runtime_crop: 'centered background-size cover + scale-105; evidence must survive 16:9 and 9:16',
        source_of_truth: 'novel + compiled scenarios/raw + docs/visual/BACKGROUND_VISUAL_AUDIT_2026-08.md',
      },
    },
  });

  if (result.isError === true) {
    throw new Error(`visual.prepare_generation failed: ${JSON.stringify(result.content)}`);
  }
  const pkg = result.structuredContent;
  if (!pkg || pkg.project_id !== 'bottom-of-thirst' || pkg.asset_type !== 'background') {
    throw new Error(`Unexpected package identity: ${JSON.stringify(pkg)}`);
  }
  if (!Array.isArray(pkg.prompt_package?.subject_lock) || pkg.prompt_package.subject_lock.length !== 0) {
    throw new Error('Background package unexpectedly contains a character subject lock.');
  }
  if (pkg.policy?.must_use_approved_anchor !== false || pkg.policy?.must_not_chain_from_candidate !== true || pkg.policy?.must_review_after_generation !== true) {
    throw new Error(`Unexpected background policy: ${JSON.stringify(pkg.policy)}`);
  }
  const refs = Array.isArray(pkg.reference_assets) ? pkg.reference_assets : [];
  const source = refs.find((asset) => asset?.role === 'source_asset' && asset?.path === 'public/images/backgrounds/underground_stairs.jpg');
  if (!source) throw new Error(`Expected source_asset reference missing: ${JSON.stringify(refs)}`);
  if (refs.some((asset) => asset?.role === 'subject_anchor' || asset?.role === 'global_reference')) {
    throw new Error(`Background package inherited character-only references: ${JSON.stringify(refs)}`);
  }
  if (pkg.prompt_package?.grand_design_contract?.asset_type !== 'background') {
    throw new Error(`Background Grand Design contract missing: ${JSON.stringify(pkg.prompt_package?.grand_design_contract)}`);
  }

  await writeFile('underground-stairs-generation-package.json', `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log('subjectless background Generation Package: PASS');
  console.log(`references: ${JSON.stringify(refs)}`);
} finally {
  await client.close().catch(() => undefined);
}

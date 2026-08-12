import type { CanonProjectDefinition } from './canon/adapter.js';
import { DEFAULT_PROJECT_DOCUMENTS } from './canon/adapter.js';

export const bottomOfThirstDefinition: CanonProjectDefinition = {
  projectId: 'bottom-of-thirst',
  documents: { ...DEFAULT_PROJECT_DOCUMENTS },
  subjects: {
    souma: { id: 'souma', displayName: '逶ｸ鬥ｬ 蛛･莠ｺ', characterFile: 'docs/characters/soma.md', canonHeading: '逶ｸ鬥ｬ 蛛･莠ｺ' },
    saya: { id: 'saya', displayName: '豌ｴ荳・ 豐呵ｶ', characterFile: 'docs/characters/saya.md', canonHeading: '豌ｴ荳・ 豐呵ｶ' },
    hikawa_ruka: { id: 'hikawa_ruka', displayName: '豌ｷ蟾・迹闃ｱ', characterFile: 'docs/characters/hikawa.md', canonHeading: '豌ｷ蟾・迹闃ｱ' },
    kagami: { id: 'kagami', displayName: '髀｡ 邇ｲ螟ｮ', characterFile: 'docs/characters/kagami.md', canonHeading: '髀｡ 邇ｲ螟ｮ' },
    kitou: { id: 'kitou', displayName: '鬯ｼ鬆ｭ 蜴ｳ螻ｱ', characterFile: 'docs/characters/kito.md', canonHeading: '鬯ｼ鬆ｭ 蜴ｳ螻ｱ' },
  },
  labels: {
    avoidBlockHeading: 'Fixed Avoid Block',
    allowedChangesHeading: '螟画峩縺励※繧医＞繧ゅ・',
    forbiddenChangesHeading: '螟画峩縺励※縺ｯ縺・￠縺ｪ縺・ｂ縺ｮ',
    commonRulesHeading: '蜈ｱ騾壹Ν繝ｼ繝ｫ',
    acceptedConditionsHeading: '謗｡逕ｨ縺吶ｋ隕冶ｦ壽擅莉ｶ',
  },
};

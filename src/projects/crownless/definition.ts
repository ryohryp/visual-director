import type { CanonProjectDefinition } from '../canon/adapter.js';

export const crownlessDefinition: CanonProjectDefinition = {
  projectId: 'crownless',
  documents: {
    globalStyle: 'docs/visual/GLOBAL_VISUAL_STYLE.md',
    characterCanon: 'docs/visual/CHARACTER_VISUAL_CANON.md',
    worldDirection: 'docs/visual/WORLD_DIRECTION.md',
    assetManifest: 'docs/assets/README.md',
    globalReference: 'docs/assets/crownless-visual-design-reference-v0.1.jpg',
  },
  subjects: {
    'player-unarmed': {
      id: 'player-unarmed',
      displayName: '素手の主人公',
      characterFile: 'docs/visual/CHARACTER_VISUAL_CANON.md',
      canonHeading: '素手の主人公',
    },
    'enemy-rusher': {
      id: 'enemy-rusher',
      displayName: '敵：Rusher',
      characterFile: 'docs/visual/CHARACTER_VISUAL_CANON.md',
      canonHeading: '敵：Rusher',
    },
    'enemy-guard': {
      id: 'enemy-guard',
      displayName: '敵：Guard',
      characterFile: 'docs/visual/CHARACTER_VISUAL_CANON.md',
      canonHeading: '敵：Guard',
    },
    'enemy-skirmisher': {
      id: 'enemy-skirmisher',
      displayName: '敵：Skirmisher',
      characterFile: 'docs/visual/CHARACTER_VISUAL_CANON.md',
      canonHeading: '敵：Skirmisher',
    },
  },
  labels: {
    avoidBlockHeading: 'Fixed Avoid Block',
    allowedChangesHeading: 'Allowed Changes',
    forbiddenChangesHeading: 'Forbidden Changes',
    commonRulesHeading: 'Common rules',
    acceptedConditionsHeading: 'Accepted visual conditions',
  },
};

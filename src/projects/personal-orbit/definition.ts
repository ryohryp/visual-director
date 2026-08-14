import type { CanonProjectDefinition } from '../canon/adapter.js';
import { DEFAULT_PROJECT_LABELS } from '../canon/adapter.js';

export interface PersonalOrbitProjectDefinition extends CanonProjectDefinition {
  approvedAnchors: Readonly<Record<string, string>>;
}

export const personalOrbitDefinition: PersonalOrbitProjectDefinition = {
  projectId: 'personal-orbit',
  documents: {
    globalStyle: 'public/dashboard/agent-town-world.css',
    characterCanon: 'public/dashboard/agent-town-orby-canvas.js',
    worldDirection: 'public/dashboard/agent-town-world.js',
    assetManifest: 'public/dashboard/agent-town.html',
    globalReference: 'public/dashboard/assets/agent-town/orby-town-visual-anchor.webp',
  },
  subjects: {
    'orby-town': {
      id: 'orby-town',
      displayName: 'Orby Town',
      characterFile: 'public/dashboard/agent-town-orby-canvas.js',
      canonHeading: 'Orby Town',
    },
  },
  labels: { ...DEFAULT_PROJECT_LABELS },
  approvedAnchors: {
    'orby-town': 'public/dashboard/assets/agent-town/orby-town-visual-anchor.webp',
  },
};

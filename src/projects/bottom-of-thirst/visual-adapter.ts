import { section, subsection } from '../../domain/markdown.js';
import type { ApprovedAnchorSummary } from '../../domain/types.js';
import {
  approvedAnchorPaths,
  BottomOfThirstAdapter,
  bottomOfThirstCanonSubject,
  configuredSubjects,
} from './adapter.js';

export class BottomOfThirstVisualAdapter extends BottomOfThirstAdapter {
  protected override async listApprovedAnchors(canonMarkdown: string): Promise<ApprovedAnchorSummary[]> {
    const anchors: ApprovedAnchorSummary[] = [];
    for (const subjectId of configuredSubjects()) {
      const configured = bottomOfThirstCanonSubject(subjectId);
      if (!configured) continue;
      const canonSection = section(canonMarkdown, configured.canonHeading);
      const paths = approvedAnchorPaths(subsection(canonSection, 'Approved Visual Anchor'));
      const anchorPath = paths[0];
      if (!anchorPath) continue;
      await this.source.ensureFile(anchorPath, `Approved Anchor for ${subjectId}`);
      const fallback = paths[1];
      if (fallback && !(await this.source.fileExists(fallback))) {
        throw new Error(`Approved Anchor fallback is missing for ${subjectId}: ${fallback}`);
      }
      anchors.push({
        subject_id: configured.id,
        display_name: configured.canonHeading,
        asset_type: 'character_visual_anchor',
        path: anchorPath,
        status: 'approved',
      });
    }
    return anchors;
  }
}

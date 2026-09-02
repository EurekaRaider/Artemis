import { useState } from "react";

import {
  EnvironmentControl,
  EnvironmentPanelSurface,
  EnvironmentSection,
  EnvironmentTrigger,
  GoalEditorFooter,
  GoalEditorInput,
  GoalEditorSurface,
  ReviewDiff,
  ReviewDiffHeader,
  ReviewDiffHunk,
  ReviewDiffLine,
  ReviewDiffLines,
  ReviewDiffReader,
  ReviewFileSidebar,
  ReviewState,
  ReviewSurface,
  ReviewToolbar,
  ReviewWorkspace,
  SourceEntry,
  SourceEntryBody,
  SourceEntryIcon,
  SourcesScroll,
  SourcesSurface,
} from "@artemis/ui/workflow";

import { GalleryActionIcon } from "./gallery-action-icon.js";

export function WorkflowGallery() {
  const [environmentOpen, setEnvironmentOpen] = useState(true);
  const [goal, setGoal] = useState(
    "Migrate Review, Environment, Goal, and Sources to public UI surfaces.",
  );

  return (
    <div className="gallery-workflow-grid">
      <ReviewSurface label="Gallery code review">
        <ReviewToolbar>
          <strong>Workspace against main</strong>
          <button type="button">Refresh</button>
        </ReviewToolbar>
        <ReviewWorkspace>
          <ReviewDiffReader label="Gallery diff">
            <ReviewDiff state="selected">
              <ReviewDiffHeader>
                <span>M</span>
                <strong>apps/desktop/src/renderer/App.tsx</strong>
                <span>+2 −1</span>
              </ReviewDiffHeader>
              <ReviewDiffHunk>
                <div className="review-hunk">@@ -12,2 +12,3 @@</div>
                <ReviewDiffLines>
                  <ReviewDiffLine kind="context">
                    12 const state = ready;
                  </ReviewDiffLine>
                  <ReviewDiffLine kind="deletion">
                    13 legacySurface();
                  </ReviewDiffLine>
                  <ReviewDiffLine kind="addition">
                    13 publicSurface();
                  </ReviewDiffLine>
                </ReviewDiffLines>
              </ReviewDiffHunk>
            </ReviewDiff>
          </ReviewDiffReader>
          <ReviewFileSidebar label="Gallery changed files">
            <button
              aria-pressed="true"
              className="review-file-entry selected"
              type="button"
            >
              App.tsx <span>+2 −1</span>
            </button>
            <button
              aria-pressed="false"
              className="review-file-entry"
              type="button"
            >
              workflow.tsx <span>+180</span>
            </button>
          </ReviewFileSidebar>
        </ReviewWorkspace>
      </ReviewSurface>

      <div className="gallery-workflow-side">
        <EnvironmentControl open={environmentOpen}>
          <EnvironmentTrigger
            controls="gallery-environment-details"
            expanded={environmentOpen}
            icon={<GalleryActionIcon />}
            label="Gallery Environment"
            onClick={() => setEnvironmentOpen((current) => !current)}
          />
          {environmentOpen && (
            <EnvironmentPanelSurface
              id="gallery-environment-details"
              label="Gallery Environment details"
            >
              <EnvironmentSection
                action={<button type="button">Refresh</button>}
                title="Git · Artemis"
              >
                <button className="environment-row" type="button">
                  <span>main</span>
                  <strong>Clean</strong>
                </button>
                <p className="environment-pr-warning">
                  HEAD has not been pushed.
                </p>
              </EnvironmentSection>
              <EnvironmentSection title="PR checks">
                <div className="environment-check-list">
                  <div>
                    <span>Passed</span>
                    <strong>Build</strong>
                  </div>
                  <div>
                    <span>Pending</span>
                    <strong>Native sandbox</strong>
                  </div>
                </div>
              </EnvironmentSection>
            </EnvironmentPanelSurface>
          )}
        </EnvironmentControl>

        <GoalEditorSurface label="Gallery Goal" state="dirty">
          <GoalEditorInput
            aria-label="Gallery Goal objective"
            onChange={(event) => setGoal(event.target.value)}
            value={goal}
          />
          <GoalEditorFooter
            actions={
              <>
                <button type="button">Revert</button>
                <button type="button">Save</button>
              </>
            }
          >
            Unsaved changes
          </GoalEditorFooter>
        </GoalEditorSurface>

        <SourcesSurface label="Gallery Sources">
          <SourcesScroll>
            <SourceEntry>
              <SourceEntryIcon>
                <GalleryActionIcon />
              </SourceEntryIcon>
              <SourceEntryBody>
                <h2>visual-migration-ledger.md</h2>
                <p>File · added to task</p>
              </SourceEntryBody>
            </SourceEntry>
            <SourceEntry>
              <SourceEntryIcon className="web">
                <GalleryActionIcon />
              </SourceEntryIcon>
              <SourceEntryBody>
                <h2>3 searches · 8 results</h2>
                <p>Used by parent agent</p>
              </SourceEntryBody>
            </SourceEntry>
          </SourcesScroll>
        </SourcesSurface>

        <ReviewState state="error">
          The selected comparison is unavailable.
        </ReviewState>
      </div>
    </div>
  );
}

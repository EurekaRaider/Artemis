import { createRoot } from "react-dom/client";
import { useState } from "react";
import { WorkspaceBrowserPanel } from "../../src/renderer/workspace/WorkspacePreviewPanel.js";
import { ComposerContextBar } from "../../src/renderer/conversation/ComposerContextBar.js";
import "@artemis/theme-artemis/theme.css";
import "../../../../packages/ui/src/styles.css";
import "../../src/renderer/styles/styles.css";
function Fixture() {
  const [draft, setDraft] = useState("");
  const [generation, setGeneration] = useState(0);
  const [mode, setMode] = useState<"plan" | "work" | "codemode">("work");
  return (
    <>
      <div style={{ height: "calc(100vh - 150px)", display: "flex" }}>
        <WorkspaceBrowserPanel
          key={generation}
          tabId="preview"
          threadId="fixture"
          path={undefined}
          revision={undefined}
          title="Browser verification"
          emptyMessage="Empty"
          refreshLabel="Reload"
          backLabel="Back"
          forwardLabel="Forward"
          goLabel="Go"
          addressPlaceholder="Address"
          initialUrl={new URLSearchParams(location.search).get("url")!}
          locale="zh-CN"
          onEvidence={(text, image) => {
            setDraft(text);
            document.body.dataset.hasImage = String(Boolean(image?.data));
          }}
        />
      </div>
      <ComposerContextBar
        locale="zh-CN"
        projects={[]}
        mode={mode}
        modeActionsDisabled={false}
        branchActionsDisabled
        projectActionsDisabled
        onClearProject={() => {}}
        onError={() => {}}
        onModeChange={setMode}
        onOpenProject={async () => {}}
        onSelectProject={() => {}}
      />
      <button data-remount onClick={() => setGeneration(generation + 1)}>
        Reopen tab
      </button>
      <textarea
        aria-label="Chat draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </>
  );
}
Object.assign(document.documentElement.dataset, {
  artemisSkin: "com.artemis.default",
  artemisTheme: "light",
  artemisContrast: "normal",
});
createRoot(document.getElementById("root")!).render(<Fixture />);

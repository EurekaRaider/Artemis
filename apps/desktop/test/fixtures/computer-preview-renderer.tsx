import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { BrowserSessionSnapshot } from "@artemis/protocol";
import { PreviewCanvas } from "../../src/renderer/computer-use/PreviewCanvas.js";
import "../../src/renderer/computer-use/computer-preview.css";
function Fixture() {
  const [snapshot, setSnapshot] = useState<BrowserSessionSnapshot>();
  useEffect(() => {
    const listener = window.artemis.onBrowserSession((value) => {
      if (value.threadId === "fixture" && value.tabId === "original")
        setSnapshot(value);
    });
    void window.artemis
      .browserSession({
        action: "snapshot",
        threadId: "fixture",
        tabId: "original",
      })
      .then(setSnapshot);
    return listener;
  }, []);
  return (
    snapshot && (
      <PreviewCanvas
        browser={snapshot}
        sessionId={snapshot.sessionId}
        label="Fixture browser"
      />
    )
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);

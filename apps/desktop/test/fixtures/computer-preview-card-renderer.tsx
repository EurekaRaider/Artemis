import { createRoot } from "react-dom/client";
import { ComputerPreview } from "../../src/renderer/computer-use/ComputerPreview.js";

createRoot(document.getElementById("root")!).render(
  <ComputerPreview locale="zh-CN" threadId="synthetic-task" />,
);

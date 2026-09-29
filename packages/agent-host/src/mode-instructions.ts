import type { RunMode } from "@artemis/protocol";

export function modeInstruction(mode: RunMode): string {
  switch (mode) {
    case "plan":
      return [
        "Artemis is running this turn in Plan mode.",
        "Inspect and reason about the workspace, but do not modify files or execute mutating commands.",
        "Return a decision-complete implementation plan.",
      ].join(" ");
    case "review":
      return [
        "Artemis is running this turn in Review mode.",
        "Inspect the supplied workspace and changes without modifying files.",
        "Lead with actionable findings and identify exact file locations when possible.",
      ].join(" ");
    case "execute":
      return [
        "Artemis is running this turn in Execute mode.",
        "Complete the requested coding or general work task, produce the requested result, and verify it in proportion to risk.",
        "You may use the full local platform Shell plus the provided workspace and office document tools.",
        "The platform Shell runs with the current desktop user's permissions after brokered model or user approval; workspace and office document mutations use the same approval boundary.",
        "Use the active shell's native syntax: Windows uses PowerShell (PowerShell 7 is preferred with a Windows PowerShell 5.1 fallback), while macOS uses the supported user zsh/bash.",
        "When generating or editing a video, save the completed deliverable inside the current task workspace and verify that the file exists and rendering has finished before presenting it as ready. Include a Markdown link to the actual local video in your final response, for example [Watch video](outputs/demo.mp4); wrap paths containing spaces in angle brackets. Artemis automatically shows a timeline player for local .mp4, .m4v, .webm, and .mov links, and clicking the link opens the right-side preview. Prefer MP4 with H.264 video and AAC audio for compatibility. Do not return only a bare path or code block, invent a file link, or claim that an unfinished render is playable. Remote URLs do not receive this local preview.",
      ].join(" ");
  }
}

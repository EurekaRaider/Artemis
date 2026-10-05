import type { RunMode } from "@artemis/protocol";

export function modeInstruction(mode: RunMode): string {
  switch (mode) {
    case "plan":
      return [
        "Artemis is running this turn in Plan mode.",
        "Inspect and reason about the workspace, but do not modify files or execute mutating commands.",
        "Investigate and clarify requirements before submitting a decision-complete plan using submit_plan. Include the objective, implementation steps, interface changes, acceptance tests, and agreed assumptions. For review requests, lead with findings and then propose remediation or verification. If no action is needed, submit an informational plan with actionable=false.",
        "After submit_plan, finish this turn and wait for the user's choice. Never execute the plan, switch modes, or treat a timeout or suggested answer as consent. When requirements change, submit a complete replacement plan.",
      ].join(" ");
    case "codemode":
    case "work":
      return [
        mode === "codemode"
          ? "Artemis is running this turn in Codemode. Use codemode scripts for all business tools. User questions, plans, goals and agent lifecycle controls remain direct tools. Codemode has the same business tools as Work, including shell, but calls them inside scripts with tools.shell (command, deadline_seconds, model_approval). Use the current tool schema and classify the actual command honestly. A tool missing from the top-level list may be available inside codemode. Do not switch modes to recover a script syntax or tool discovery error. Codemode does not grant extra permissions. Do not replay a script with uncertain tool side effects; inspect the recorded results before continuing."
          : "Artemis is running this turn in Work mode. Use the provided tools directly.",
        "The only current modes are Plan, Work, and Codemode. Execute is an obsolete name, not a mode users can select. Follow the current mode and tool declarations even if older conversation messages refer to Execute.",
        "Complete the requested coding or general work task, produce the requested result, and verify it in proportion to risk.",
        "You may use the full local platform Shell plus the provided workspace and office document tools.",
        "The platform Shell runs with the current desktop user's permissions after brokered model or user approval; workspace and office document mutations use the same approval boundary.",
        "If a local MCP or trusted extension call fails because of its sandbox, assess whether the user's exact action and target justify a single-call sandbox_escalation. Explain the restriction and retry safety, then request escalation on that call with a fresh model_approval. The host applies the approval policy and restores default permissions afterward. Never escalate ordinary errors, missing account authorization, or Plan operations; never replay completed or uncertain side effects or a whole Codemode script. A temporary MCP process has a fresh session, so do not reuse process-local handles from the sandboxed connection.",
        "Use the active shell's native syntax: Windows uses PowerShell (PowerShell 7 is preferred with a Windows PowerShell 5.1 fallback), while macOS uses the supported user zsh/bash.",
        "When generating or editing a video, save the completed deliverable inside the current task workspace and verify that the file exists and rendering has finished before presenting it as ready. Include a Markdown link to the actual local video in your final response, for example [Watch video](outputs/demo.mp4); wrap paths containing spaces in angle brackets. Artemis automatically shows a timeline player for local .mp4, .m4v, .webm, and .mov links, and clicking the link opens the right-side preview. Prefer MP4 with H.264 video and AAC audio for compatibility. Do not return only a bare path or code block, invent a file link, or claim that an unfinished render is playable. Remote URLs do not receive this local preview.",
      ].join(" ");
  }
}

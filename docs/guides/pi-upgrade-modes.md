[English / 简体中文](pi-upgrade-modes-zh-CN.md)

# Pi 1.1.0 and Artemis task modes

Artemis uses Pi as its only agent loop. New tasks start in **Work**.

The desktop and Agent Host pin `pi-ai` and `pi-coding-agent` to 1.1.0. This upgrade includes Codemode output separation, provider retry and pricing fixes, and the updated model catalog. Artemis already uses `createAssistantMessageEventStream()`, as required by the new stream type contract. The event adapter recognizes `agent_settled.aborted` without treating intentional tool-boundary stops as user cancellation. Provider login supplies `Artemis` as the agent name. The install check continues to require `brace-expansion` 5.0.12.

| Mode     | Tools and completion                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan     | Read-only investigation, discussion and review. The main agent finishes with `submit_plan`; the complete plan waits for the user.                                 |
| Work     | Approved business tools are called directly.                                                                                                                      |
| Codemode | Pi's official Codemode extension orchestrates business tools in JavaScript. Questions, plans, goals and agent lifecycle controls remain direct, model-only tools. |

The composer mode selector, Slash menu clicks, keyboard selection and typed `/plan`, `/work`, `/codemode` use the same mode switch. `/execute` and `/review` are removed. Review remains available as a task capability and in the Git diff panel. Mode switches occur after the active turn ends or is cancelled; submitting `/plan` with changed requirements cancels the active turn and begins revision.

## Plan confirmation

A plan card preserves the title and full Markdown in the conversation: objective, steps, interface changes, acceptance criteria and agreed assumptions. Confirmation uses the same choice list and reply field as ordinary questions, integrated into the composer. There is no separate action bar beneath the plan. **Execute plan** accepts that revision and starts Work in the same chat. The dropdown offers **Execute with Codemode**. **Add requirements** focuses the composer without consuming the plan; submitting requirements supersedes it and requests a complete replacement. Reviews without action items display **No action needed**.

Plan records are versioned host events in the session store. Acceptance validates the current revision and successful source turn, then commits the accepted version, target mode and execution checkpoint in one SQLite transaction. The execution prompt contains the full accepted body. Duplicate acceptance returns the original execution turn; failed, incomplete and superseded plans cannot execute. Text that merely looks like a plan cannot produce an actionable card.

There is no confirmation countdown. Waiting ends the model run and releases capacity. Reopening a chat restores its card. Goals, scheduled tasks, transport recovery and process restart cannot accept it. Accepted requests use normal checkpoint recovery; scripts with side effects must reconcile completed/uncertain calls instead of replaying the whole script. Goal continuation preserves Work or Codemode.

## Recovery and compatibility

Pi and the independent Responses transport retry empty starts, interrupted streams and EOF without a provider terminal event. A failed assistant attempt is replaced while earlier completed tool results stay in context. Cancellation disposes the old transport before a new attempt.

Database migration 14 maps `execute` to `work` and `review` to `plan`, after the older `code/work` migration. Old `code` never becomes Codemode. Checkpoints, history and automations are normalized. Automation grants migrate only when their original fingerprint is valid; invalid grants stay disabled. No live user database is needed to develop or test this migration. Remote IM profiles currently reject Codemode explicitly.

## Model and MCP capabilities

Custom model advanced JSON supports `samplingParams`, `samplingParamsByThinkingLevel`, `thinkingLevelMap`, `inputLimits`, `promptCache`, `cacheWarming`, `compaction`, and `virtualRoutes`. Example:

```json
{
  "samplingParams": { "temperature": 0.3 },
  "samplingParamsByThinkingLevel": { "high": { "top_p": 0.9 } },
  "cacheWarming": "idle",
  "compaction": { "reserveTokens": 12000, "keepRecentTokens": 16000 }
}
```

A virtual model uses an ordered `virtualRoutes` array of `{ "providerId", "modelId", "thinkingLevel"? }`. Pi chooses the first route for a new user request, keeps the last successful route during continuation, and advances to the next route on retry. Targets must be configured physical models.

**Model provider authorization** in Settings uses each provider's Pi API-key/OAuth flow. It is optional and starts only on a user click. Answers never enter conversation history; credentials and rotated tokens use OS-encrypted storage. Existing API-key and custom-provider setup remain available.

Work exposes `model_capabilities`, `generate_image`, and `classify` as thin bridges to Pi for configured image/classifier providers. Main and child agents in Codemode can directly use Pi's native `models.getAvailableOfType()`, `models.getModelOfType()`, `models.classify()`, and `models.generateImages()`; the `tools` bridges remain compatible. Both paths reuse the session model runtime and credentials. Native model calls receive the script cancellation signal and contribute usage to the Codemode result. Use `image(block)` to display generated images. `edit_context` changes earlier assistant/tool context projections at Pi turn boundaries while retaining original history; it cannot edit user or system instructions.

`model_capabilities` includes each model's supported `input`. `classify` accepts optional `images` containing `{ type: "image", data, mimeType }` alongside `state` and `questions`; Pi rejects images for classifiers without image support. GPT-6 Luna classification requires an OpenAI API key and is not available through Sign in with ChatGPT. Classification remains unavailable in Plan.

MCP tools retain host approval and sandbox enforcement, including after discovery. Structured output schemas, structured results and namespace metadata are passed through to Pi. Existing desktop OAuth supports metadata clients, issuer checking and per-server credential storage. User server configurations support `exposure` and `toolExposure`; `.pi/mcp.json` can restrict existing enabled servers by ID/name, hide tools or change discovery exposure. Project files cannot launch new servers or expand the host's permissions. Plan receives no MCP tools.

In Work and Codemode, a local MCP or trusted extension tool may request `sandbox_escalation: { justification }` after a sandbox denial, alongside a fresh `model_approval`. The model must explain why this exact user-authorized operation needs desktop-user access and why retrying it cannot duplicate uncertain side effects. The host treats escalation as high risk: agent approval requires an explicit user request for the action and target; otherwise the normal approval UI offers one-time approval only. Saved tool grants, automation grants, Computer Use task grants, and permission-hook allowances do not authorize this escalation. The active turn is checked again when an approval executes. Plan, remote MCP authorization, remote permission profiles, and extension trust cannot be bypassed.

An escalated MCP call uses a fresh local server connection, closes it afterward, and preserves the saved server configuration and minimal/explicitly forwarded environment. The original sandboxed connection remains available for subsequent calls. Process-local handles from that original connection cannot be assumed to work in the temporary connection. Executable extensions use desktop-user access for that invocation only. Neither route grants administrator/root or operating-system privacy permissions. Failures do not automatically escalate or replay whole Codemode scripts.

Trusted executable extensions retain their project/content-hash trust and native sandbox. Their output schemas, namespace, annotations and structured results cross the sandbox bridge. Terminal UI renderers, commands, shortcuts and arbitrary lifecycle handlers remain outside the sandboxed desktop tool bridge; Artemis reports unsupported extension surfaces instead of running them in the main process.

Custom sub-agents inherit the active mode and host permissions. The settings editor no longer offers a tool allowlist; legacy stored allowlists are read and saved as `inherit`, and old runtime snapshots cannot restore the removed whitelist. Child MCP tools use the normal host approval and sandbox path, including mutating tools in Work/Codemode. Plan restrictions, connection/trust checks, delegated write scopes and agent lifecycle rules still apply.

## Validation boundaries

Automated coverage includes real Pi loops, real local HTTP socket reset/EOF, completed-tool retention, plan persistence/acceptance, stale revisions, duplicate clicks, migration, model routing and encrypted credential updates. Desktop interaction tests use an isolated user directory, a local model fixture and ordinary activation-free startup. Live provider OAuth, paid model operations, physical Wi-Fi loss, Windows packaging and macOS release signing/notarization require their own environment and are not implied by these checks.

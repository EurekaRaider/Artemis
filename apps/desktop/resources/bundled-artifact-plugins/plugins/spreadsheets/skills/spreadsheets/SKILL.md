---
name: spreadsheets
description: Create, read, and make basic normalized edits to Excel .xlsx files with Artemis's built-in office_document tool.
---

# Spreadsheets Lite

Use this Skill for basic Excel workbook work that does not require a Codex primary runtime or a spreadsheet Connector.

## Tool and mode

- Use the built-in `office_document` tool for every spreadsheet operation.
- The tool is available in Execute mode. If it is unavailable, ask the user to switch the task to Execute mode.
- Do not call `load_workspace_dependencies`, install packages, look for a Codex runtime, or require an Excel Connector.
- Use workspace-relative `.xlsx` paths and provide the required model approval decision truthfully.

## Supported workflow

- Create or overwrite a workbook from named sheets and primitive cell values.
- Read sheets as normalized rows and cells.
- Modify one cell with a `set-cell` patch using one-based row and column numbers.
- Delete a workbook when the user explicitly requests it.

Before overwriting or deleting, confirm that the request identifies the intended file. After a write, report the resulting path and any warnings returned by the tool.

## Lite limitations

This workflow preserves normalized sheet names and primitive cell values. It does not promise fidelity for formulas, charts, pivot tables, macros, external links, conditional formatting, merged cells, or advanced styling. Explain that limitation before changing an existing workbook when it matters to the request.

## Optional native Office sessions

The host-managed `office-core` capability enhances this same plugin. Documents, Presentations and Spreadsheets share one installation. Never download or install the runtime with bash, npm or an extension; the user manages it through the plugin's Office capability panel, including online installation, update checks, and verified offline import. The official runtime source is https://github.com/EurekaRaider/ArtemisRelease/releases; the host maps this plugin's optional `office-core` dependency to its bundled trusted release catalog. Once installed, the entry is called “Manage Office configuration”.

- Lite remains available without the capability. Imported originals and files changed outside Lite cannot be overwritten through Lite `write` or `modify`. Preserve the original and create a separate file when a normalized copy is wanted.
- For continuous edits with an installed, accepted capability, call `office_document` with `operation: "open"`. Reuse the returned `sessionId` as `session_id`.
- Send `operation: "apply"`, a stable unique `operation_id`, the last `expected_version`, and a structured `change`. Word uses paragraph UTF-16 offsets (`replace-text`); slides use page/object indices (`set-object-text`); sheets use `set-cells` or explicit `set-formula`.
- Retry uncertain operations with the identical operation ID and body. Read `operation: "snapshot"` after a version conflict. Never guess selection indices from an older version.
- Each acknowledged operation is an unsaved live draft. The host renders it before saving. Only `operation: "save"` with the expected version writes the original. Report saved, draft and preview versions separately.
- If compatibility validation blocks save, keep the draft and original and report the exact reason. Do not fall back to Lite, bash or rebuilding the original. This development branch has not yet accepted the native compatibility matrix.
- `operation: "close"` refuses unsaved changes. Only set `discard: true` when the user explicitly wants to discard them. Closing a preview tab does not discard the draft.
- An external-change event is a file-level update, not evidence of paragraph/cell-level edits. Preserve the live draft before reopening an externally changed original.
- User annotations include `sourceVersion` and a selection. Check the version before acting on an annotation; do not apply old offsets to new content.

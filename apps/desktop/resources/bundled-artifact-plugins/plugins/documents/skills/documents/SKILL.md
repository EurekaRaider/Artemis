---
name: documents
description: Create, read, and make basic normalized edits to Word .docx files with Artemis's built-in office_document tool.
---

# Documents

Use this Skill for basic Word document work that does not require a Codex primary runtime.

## Tool and mode

- Use the built-in `office_document` tool for every document operation.
- The tool requires the installed Office suite and Work or Codemode. If it is unavailable, ask the user to install the Office suite in Resources → Plugins and use Work or Codemode.
- Do not call `load_workspace_dependencies`, install packages, or look for a Codex runtime.
- Use workspace-relative `.docx` paths and provide the required model approval decision truthfully.

## Supported workflow

- Create or overwrite a document from ordered paragraphs and heading levels 1 through 6.
- Read a document as normalized paragraphs.
- Modify text with a `replace-text` patch.
- Delete a document when the user explicitly requests it.

Before overwriting or deleting, confirm that the request identifies the intended file. After a write, report the resulting path and any warnings returned by the tool.

## Content limitations

This workflow preserves normalized text and headings. It does not promise fidelity for tracked changes, comments, macros, embedded objects, complex tables, page layout, fonts, or other advanced formatting. Explain that limitation before changing an existing document when it matters to the request.

## Native Office sessions

The Office suite must be installed and active before any document operation. Install it once from Resources → Plugins → Office. Never install the runtime through bash, npm or an extension.

- Every operation requires the installed Office suite. Imported originals and externally modified files cannot be overwritten through normalized `write` or `modify`. Preserve the original and create a separate file when a normalized copy is wanted.
- For continuous edits with an installed, accepted capability, call `office_document` with `operation: "open"`. Reuse the returned `sessionId` as `session_id`.
- Send `operation: "apply"`, a stable unique `operation_id`, the last `expected_version`, and a structured `change`. Word uses paragraph UTF-16 offsets (`replace-text`); slides use page/object indices (`set-object-text`); sheets use `set-cells` or explicit `set-formula`.
- Retry uncertain operations with the identical operation ID and body. Read `operation: "snapshot"` after a version conflict. Never guess selection indices from an older version.
- Each acknowledged operation is an unsaved live draft. The host renders it before saving. Only `operation: "save"` with the expected version writes the original. Report saved, draft and preview versions separately.
- If compatibility validation blocks save, keep the draft and original and report the exact reason. Do not fall back to normalized writes, bash or rebuilding the original. This development branch has not yet accepted the native compatibility matrix.
- `operation: "close"` refuses unsaved changes. Only set `discard: true` when the user explicitly wants to discard them. Closing a preview tab does not discard the draft.
- An external-change event is a file-level update, not evidence of paragraph/cell-level edits. Preserve the live draft before reopening an externally changed original.
- User annotations include `sourceVersion` and a selection. Check the version before acting on an annotation; do not apply old offsets to new content.

- Region annotations use page-relative coordinates from 0 to 1 with the origin at the top-left. Their optional `quote` contains visible PDF text runs as context, not native paragraph or cell offsets. Verify that context against the current snapshot and rendered page; do not guess a paragraph, object or cell from page coordinates. If the target is ambiguous, ask for a more precise selection before editing.

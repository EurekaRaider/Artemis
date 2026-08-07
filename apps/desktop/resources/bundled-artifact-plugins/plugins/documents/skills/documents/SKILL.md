---
name: documents
description: Create, read, and make basic normalized edits to Word .docx files with Artemis's built-in office_document tool.
---

# Documents Lite

Use this Skill for basic Word document work that does not require a Codex primary runtime.

## Tool and mode

- Use the built-in `office_document` tool for every document operation.
- The tool is available in Execute mode. If it is unavailable, ask the user to switch the task to Execute mode.
- Do not call `load_workspace_dependencies`, install packages, or look for a Codex runtime.
- Use workspace-relative `.docx` paths and provide the required model approval decision truthfully.

## Supported workflow

- Create or overwrite a document from ordered paragraphs and heading levels 1 through 6.
- Read a document as normalized paragraphs.
- Modify text with a `replace-text` patch.
- Delete a document when the user explicitly requests it.

Before overwriting or deleting, confirm that the request identifies the intended file. After a write, report the resulting path and any warnings returned by the tool.

## Lite limitations

This workflow preserves normalized text and headings. It does not promise fidelity for tracked changes, comments, macros, embedded objects, complex tables, page layout, fonts, or other advanced formatting. Explain that limitation before changing an existing document when it matters to the request.

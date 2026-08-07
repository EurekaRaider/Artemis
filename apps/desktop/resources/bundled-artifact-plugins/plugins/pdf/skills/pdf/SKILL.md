---
name: pdf
description: Create, read, and make basic normalized text edits to PDF files with Artemis's built-in office_document tool.
---

# PDF Lite

Use this Skill for basic text-oriented PDF work that does not require a Codex primary runtime.

## Tool and mode

- Use the built-in `office_document` tool for every PDF operation.
- The tool is available in Execute mode. If it is unavailable, ask the user to switch the task to Execute mode.
- Do not call `load_workspace_dependencies`, install packages, or look for a Codex runtime.
- Use workspace-relative `.pdf` paths and provide the required model approval decision truthfully.

## Supported workflow

- Create or overwrite a PDF from text pages, optionally with page width and height.
- Read a PDF as normalized page text.
- Modify text with a `replace-text` patch.
- Delete a PDF when the user explicitly requests it.

Before overwriting or deleting, confirm that the request identifies the intended file. After a write, report the resulting path and any warnings returned by the tool.

## Lite limitations

This workflow is intended for normalized text pages. It does not promise pixel-perfect layout, OCR, annotations, forms, signatures, embedded media, font fidelity, or preservation of arbitrary existing PDF drawing commands. Explain that limitation before changing an existing PDF when it matters to the request.

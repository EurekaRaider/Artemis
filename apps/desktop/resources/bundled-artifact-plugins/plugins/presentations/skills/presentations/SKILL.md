---
name: presentations
description: Create, read, and make basic normalized edits to PowerPoint .pptx files with Artemis's built-in office_document tool.
---

# Presentations Lite

Use this Skill for basic PowerPoint work that does not require a Codex primary runtime.

## Tool and mode

- Use the built-in `office_document` tool for every presentation operation.
- The tool is available in Execute mode. If it is unavailable, ask the user to switch the task to Execute mode.
- Do not call `load_workspace_dependencies`, install packages, or look for a Codex runtime.
- Use workspace-relative `.pptx` paths and provide the required model approval decision truthfully.

## Supported workflow

- Create or overwrite a presentation from slide titles and body lines.
- Read a presentation as normalized slide text.
- Modify text with a `replace-text` patch.
- Delete a presentation when the user explicitly requests it.

Before overwriting or deleting, confirm that the request identifies the intended file. After a write, report the resulting path and any warnings returned by the tool.

## Lite limitations

This workflow preserves normalized slide text. It does not promise fidelity for themes, master layouts, exact positioning, charts, images, media, speaker notes, transitions, or animations. Explain that limitation before changing an existing presentation when it matters to the request.

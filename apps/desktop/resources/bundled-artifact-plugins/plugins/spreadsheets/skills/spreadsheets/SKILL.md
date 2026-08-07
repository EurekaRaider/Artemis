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

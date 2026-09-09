# Management appearance review — September 9, 2026

Issues #170–#176 use the Direction A prototype as the reference. This review
covers the production renderer in both light and dark themes; it does not
exercise remote providers, live IM tenants, or installed plugin executables.
Fixtures use a local project, an archived conversation, a disabled automation,
an offline marketplace, one MCP entry, and one skill.

## Reference mapping and findings

| Surface                | Prototype contract                                                                                      | Finding and correction                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace frame        | `workspace/workspace.css`: `.workspace-header`, `.page`, `.page-pad`                                    | Secondary pages omitted the shared 48px header. Retain the header, keep each page in normal workspace flow, and retain the 26px content inset below it.                                                                                                              |
| Page canvas            | `ui/tokens.css`: Direction A `--bg`                                                                     | Resource, automation and archive pages incorrectly used panel fill. Use canvas: light `#fafafa`, dark `#141414`.                                                                                                                                                     |
| Cards and lists        | `ui/compat.css`: `--raised` maps to `--surface`; `.card`, `.res-tab.active`                             | Marketplace and automation cards and selected resource categories incorrectly used popover fill. Use panel fill: light `#ffffff`, dark `#202020`. MCP/Skills rows and the installed list already use this panel token; the corrected canvas restores their contrast. |
| Buttons                | `ui/primitives/controls.css`: `.ui-button` variants                                                     | Secondary buttons use light `#e5e5e5` / dark `#303030`; hover uses surface-2. Quiet actions are transparent and gain the surface-3 hover fill. Primary and destructive confirmation buttons retain semantic colors.                                                  |
| Archive                | `.archive-row`, `.archive-actions`                                                                      | Restore the canvas and exact row hover token. Keep primary Open, quiet Restore, and quiet red Delete. Existing delete confirmation and archive operations remain intact.                                                                                             |
| Settings structure     | `.settings-panel`, `.settings-body`, `.settings-content`, `.setting-group`; `workspace-composition.css` | Keep the existing 860px panel, 196px navigation, 18px/22px content padding, flat groups, and subtle row separators. Correct the outer dialog fill and the final prototype's 13px group headings.                                                                     |
| Settings provider tabs | `.seg-ctl`                                                                                              | Keep selected panel fill; correct the light-theme track from user-message gray to surface-3. Audit both built-in and custom provider forms.                                                                                                                          |
| Switches               | `ui/primitives/controls.css`: `.ui-switch`                                                              | Resource and settings thumbs remain white in both themes. Enabled resource tracks retain the green switch token.                                                                                                                                                     |
| Composer menus         | Issue #170, shared compact menu language                                                                | Project and branch lists gain inner row insets; all three menus use 12px labels. Mode opens above the bottom-anchored composer with 8px panel padding.                                                                                                               |
| Marketplace tabs       | Issue #171                                                                                              | Preserve single-line labels up to 240px, ellipsis, selected state, and linked panels. Show horizontal scroll controls on overflow and remove the redundant trailing market name.                                                                                     |

## Repeatable visual checks

- [x] Dark and light: marketplace card, installed list, MCP, Skills, automation,
      archive, and all six settings navigation sections.
- [x] Settings: inspect both the top and bottom of each scrollable section;
      include built-in and custom provider forms, messaging setup, Agent
      configuration, permissions, and update/diagnostics blocks.
- [x] Compare computed canvas, card, group and navigation fills with the
      reference tokens; matching flat settings groups remain transparent.
- [x] Verify secondary, primary, quiet, disabled and destructive action states;
      ensure dark cards remain distinct from the darker page canvas.
- [x] Confirm the automation header begins 26px below the workspace header,
      with the page inside the workspace and no overlap at the top.
- [x] At 1440px and 800px, exercise all three composer menus, hover insets,
      mode selection, Escape and outside-click dismissal.
- [x] At 1440px and 800px in LTR and RTL, exercise overflowing marketplace
      arrows and Home/End selection; confirm arrows disappear when tabs fit.
- [x] Toggle the isolated skill off and on; compare dark/light switch fills.
- [x] Inspect screenshots for clipping, wrapping and errors; confirm no renderer
      exception, console warning or framework error overlay.

Browser plugin was unavailable; validation used the existing Playwright runtime
with a real Electron window and isolated application data. Repository source,
typecheck, build, formatting, UI convergence and performance gates accompany
these visual checks. Cross-platform CI supplies separate native evidence;
local screenshots alone do not establish Windows or release-package acceptance.

## Sources and Dock follow-up (#176)

The source list already has a 20px outer inset in the current renderer. MCP
summary and detail content now share a 16px inner inset. Attachment rows use
10px corners, 8px horizontal insets, no separator through the hover fill, and
the existing semantic hover color. The add menu clears inherited tab-button
borders and centering, with fixed 17px icon columns and left-aligned labels.

Local preview storage remains private and task-scoped. Failed reads show an
unavailable label on the attachment; decode failures replace broken thumbnails
and close failed previews with instructions to attach the image again. Late
reads from a previous task cannot open a preview in the newly selected task.
Valid, missing, and corrupt image fixtures cover both data paths. No lost
historical image bytes are reconstructed or claimed recoverable.

- [x] In dark/light themes at 1440px and 800px, verify MCP outer/inner insets,
      attachment hover geometry, decoded thumbnails, successful preview and
      Escape dismissal, missing/corrupt image feedback, and aligned single-border
      add menus. All 45 checks passed in isolated Electron, with no renderer
      exceptions. Corrupt image fixtures intentionally trigger image load errors.

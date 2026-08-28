# Environment panel design QA

## Scope and evidence

- Target: Artemis environment panel, branch picker, source preview, and their icons.
- Codex reference: `/var/folders/q4/0bnt81q519s22p1f5rzqf1z00000gn/T/TemporaryItems/NSIRD_screencaptureui_0IvfEe/截屏2026-08-28 17.51.00.png`.
- Current Codex implementation evidence: `/Applications/ChatGPT.app/Contents/Resources/app.asar` (`local-conversation-thread`, `git-branch-picker-dropdown-content`, and current icon components).
- Artemis implementation screenshot: `/tmp/artemis-environment-branch-qa.2LH7RO/branch-pass8.png`.
- Same-state side-by-side comparison: `/tmp/artemis-environment-branch-qa.2LH7RO/codex-artemis-comparison-pass8.png` (Codex left, Artemis right).
- Runtime viewport: 1420 x 920 CSS px at DPR 2; dark theme; Chinese locale.

## Acceptance comparison

| Area                     | Result | Evidence                                                                                                                                                         |
| ------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel geometry           | Pass   | 304 px wide and 375 px tall in the final fixture; Codex reference is approximately 304 x 376 CSS px.                                                             |
| Branch popup             | Pass   | Separate fixed portal to the left of the branch row; 296 px wide; no clipping by the environment panel.                                                          |
| Row density              | Pass   | 28 px summary rows, 18 px primary icons, 16 px chevrons/actions, and Codex-aligned spacing.                                                                      |
| Color and selected state | Pass   | Neutral Codex dark surfaces and selected-row treatment; no blue cast from the Artemis panel token.                                                               |
| Icons                    | Pass   | Changes, Local, Branch, Commit, GitHub, chevron, external-link, search, check, add, Sources, and web-search glyphs use the current installed Codex SVG geometry. |
| Branch behavior          | Pass   | Search, current-branch no-op, safe switch, dirty-tree commit handoff, and create-and-checkout action are wired to existing Git APIs.                             |
| Sources behavior         | Pass   | Files, MCP tools, and web search share one compact Sources preview; three-row limit; `查看全部` opens the right-side Sources tab.                                |
| Accessibility            | Pass   | Final Electron report contains `issues: []`; branch options use `menuitemradio` and `aria-checked`; controls have accessible labels.                             |

## Iterations

1. Initial capture exposed an internally clipped branch menu, over-tall rows, generic icons, a blue surface cast, and separate MCP/source sections.
2. The branch menu moved to a fixed portal and received viewport-aware placement, keyboard/outside-click dismissal, search, and branch creation.
3. Current Codex SVG paths replaced the generic environment and branch-menu glyphs.
4. MCP tools and web/file inputs were consolidated into the Codex-style Sources preview, secondary metadata was removed from compact rows, and the source limit was fixed at three.
5. Final density and color tuning produced the 375 px panel height and neutral surfaces shown in pass 8.

## Final severity gate

- P0: 0
- P1: 0
- P2: 0

Dynamic repository branch names and attached-source names are data, so they are not expected to be identical between products; layout, state, interaction, and icon geometry are the comparison targets.

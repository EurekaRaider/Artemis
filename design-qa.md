# Slash command glass QA

final result: passed

## Scope and visual reference

Only the slash-command popover material and its active/hover states changed in this iteration. Existing application typography, icons, geometry and command behavior are retained.

- Source: `/Users/williamji/.codex/generated_images/01a0b7a7-6deb-7d40-a7ba-f78a178100ba/exec-816902b6-e5aa-485d-af90-1bc70cd25c71.png` (1786 × 880 image).
- Implementation: `/private/tmp/glass-dark-1420.png` (menu with surrounding shadow, 1940 × 668 pixels).
- Additional state: `/private/tmp/glass-light-980.png`.
- Electron viewports: 1420 × 920 and 980 × 920 CSS pixels; device scale factor 2.
- State: Chinese locale, slash menu open, /goal selected, scroll at top.
- Comparison: source and implementation displayed together. Compare menu proportions and materials rather than whole image bounds: the reference includes the composer, while implementation capture focuses on the menu. No pixel-exact equivalence is claimed for the generated reference.

## Fidelity review

- Typography/content: existing font, Chinese descriptions, six command labels and hierarchy preserved; readable in both themes.
- Layout: existing row heights, spacing and menu size preserved. No horizontal overflow at either tested width.
- Color/material: translucent neutral panel with real 24px backdrop blur, edge highlights, floating shadow and translucent selected row. Light theme uses existing theme tokens.
- Assets: existing six colored vector icons reused; no raster replacements or additional imagery.
- Focused inspection: menu edges, selected row and small description text were directly inspected in the full-resolution menu capture.

## Comparison history

1. Initial glass capture exposed an opaque scrollbar track interrupting the right rounded glass edge (P2).
2. Applied transparent scrollbar track and thin thumb, rebuilt and recaptured both themes. The right edge is now continuous; no remaining actionable P0/P1/P2 findings.

## Validation

- Native Electron renderer through Playwright, isolated temporary profile.
- Each theme: 70 ArrowDown/ArrowUp steps, wheel scrolling and Enter selection passed; selected rows and top visible icons stayed visible.
- No renderer page errors observed. Computed backdrop filter verified; no horizontal menu overflow.
- Vite production renderer build, Prettier and git diff whitespace checks passed.
- OS reduced-transparency preference uses an opaque panel fallback; this media preference was not manually tested.

## Limits / follow-up polish

- P3: generated mock has more diffuse, irregular reflections; implementation uses deterministic CSS lighting and actual underlying content for blur.
- Verified in local macOS Electron only; no packaged installation or Windows acceptance in this change.

---

# Resource center, plugin dialogs and archive artwork — 2026-09-19

final result: passed

## Visual truth and normalization

- Approved board: `/Users/williamji/.codex/generated_images/01a0b975-af5a-7020-9d57-4d14d3f6643b/exec-59b049fe-e221-404f-9560-9402409ef92d.png`, 1536 × 1024 pixels.
- Approved archive header: `/Users/williamji/.codex/generated_images/01a0b975-af5a-7020-9d57-4d14d3f6643b/exec-fa6d55a5-183f-4956-bb18-a37756f0165d.png`, 2172 × 724 pixels.
- Browser-rendered evidence directory: `/Users/williamji/.codex/visualizations/2026/09/19/01a0b975-af5a-7020-9d57-4d14d3f6643b/code-preview/`.
- Full-view comparison: `design-comparison.png` in that directory, 2048 × 760; approved board and actual component captures combined in the same image.
- Focused comparison: `dialog-comparison.png`, 928 × 720; reference dialogs normalized from approximately 676 pixels to the implementation's 440 CSS pixels. Final implementation crops are 440 × 311 and 440 × 303 pixels.
- Archive comparison: `archive-comparison.png`, 1260 × 190. The archive edit replaces the header artwork and retains the existing page typography.
- Final dark screenshots: `resources-dark.png`, `install-dark.png`, `connection-dark.png`, at 1420 × 946 CSS pixels; saved screenshots have the same pixel dimensions (1:1 normalized output). Crop coordinates were applied to the full screenshot, because the browser's clipped screenshot API produced a different scale.
- Light screenshots: `resources-light.png`, `plugin-icons-light.png`, 1280 × 720. Narrow screenshots: `resources-light-narrow.png`, `install-light-narrow-de.png`, `connection-light-final.png`, `archive-dark-narrow.png`, 640 × 820. `archive-light.png` is 1280 × 720.
- State: Chinese resource center, Figma install confirmation, connected GitHub account, archive empty state; German long-copy installation also checked. All data is synthetic and the production React components/CSS are used directly.

## Comparison history and findings

1. [P1, resolved] The preview omitted manifest artwork, which exposed the purple Figma line icon and GitHub outline. Audited all 10 current ArtemisPluginShop PNGs and the four bundled document plugin images. Added exact-name brand fallbacks for the 10 marketplace plugins, preserved valid manifest artwork, and supplied stable plugin identities to translated/owned resource rows. `plugin-icons-dark.png` and `plugin-icons-light.png` compare each market image with its matching fallback.
2. [P2, resolved] The initial dialog comparison showed excess header padding and weak separation between gray buttons and the raised dialog surface. Removed the redundant header padding, used the theme's base surface, restored 18px dialog titles and 14px body text, and increased footer breathing room while retaining 28px compact controls. Recaptured both themes; the final full-view and focused comparisons above were inspected after these fixes.
3. No remaining actionable P0/P1/P2 findings in the requested surfaces.

## Required fidelity surfaces

- Typography: existing system UI font stack retained; compact page title hierarchy retained to match Artemis. Dialog titles are 18px, body 14px, buttons 13px. Long German labels and descriptions wrap without clipping; dialog client/scroll widths both 438px and heights both 327px in the tested German state.
- Layout: header actions align on the first row, tabs and search share the second row on wide views; search moves below tabs at 640px. Document scroll width equals viewport width. Dialogs use 24px padding, aligned capability rows, thin separators and compact footer actions. Existing market contents and archive results layout are preserved.
- Colors: neutral theme surfaces and borders, quiet cancellation, compact gray confirmation/reconnect buttons, subdued red disconnect action and blue reconnect glyph. Light and dark themes both checked. Native keyboard focus remains visible.
- Images: transparent purple puzzle/star and purple archive-box PNGs match the approved direction; no visible dark/light edge halos at the 40px rendered size. Figma uses its full-color mark. Existing plugin brand files take precedence; missing/broken manifest images use bundled equivalents for the audited plugins. The four bundled document plugin images were already correct.
- Copy: page title is `插件、MCP 与 Skills`; original subtitle retained. Install capability counts and enabled/disabled defaults are explicit. Connection management shows one brand heading, account, status and capabilities. New copy covers all 14 supported locales.

## Interaction and verification evidence

- Browser: native Escape closes installation and restores the trigger focus; Cancel does not install; confirmation calls the mocked installation once and opens the installed plugin's own connection UI. Reconnect and disconnect each call the intended connector once; disconnect removes the account and shows the Connect action. Native dialogs prevent background interaction.
- Runtime console: no error or warning entries in the preview browser log.
- Automated renderer tests cover installation cancellation, authorization cancellation, reconnect/disconnect state refresh, locale updates and manifest-image failure recovery. Related resource, layout, localization and icon-sizing suites pass.
- Desktop typecheck, production build, skin conformance and UI convergence checks pass. The production build retains its existing large-chunk warning.

## Accepted constraints and limits

- The reference is a presentation board with separate dialogs shown together. The product uses separate interactive modal states, existing compact page typography and deterministic theme surfaces; no pixel-exact reproduction of the board's illustrative texture is claimed.
- Brand artwork follows the existing marketplace files. The Figma mark was checked against its official brand assets; other brands were checked for faithful use of their supplied marketplace images, not a historical brand-guideline audit.
- This validates local source and rendered production components with mock IPC. It does not exercise external OAuth providers, modify a real account, package/install Artemis, or establish Windows native acceptance.

## Implementation checklist

- [x] Apply approved header layout/title and both raster header icons.
- [x] Replace generic installation confirmation and simplify connection management.
- [x] Correct brand-image fallbacks across cards, dialogs and owned resource rows.
- [x] Inspect full-view and focused comparisons, light/dark themes and narrow/long-copy states.
- [x] Preserve existing installation/connection APIs and validate the changed UI behavior.

---

# Plugin source capsules and card actions — 2026-09-19

final result: passed

## Approved references and comparison

- Source tabs: `/var/folders/q4/0bnt81q519s22p1f5rzqf1z00000gn/T/codex-clipboard-4bd6bf2c-8b3e-4635-a399-cec148991197.png`.
- Plugin card: `/var/folders/q4/0bnt81q519s22p1f5rzqf1z00000gn/T/codex-clipboard-3bccc1ac-1e66-43dd-aa23-17b938f8a5ee.png`.
- Evidence directory: `/Users/williamji/.codex/visualizations/2026/09/19/01a0b9a5-d2fd-7103-a14a-ef0facd88957/plugin-layout-qa/`.
- `design-comparison.png` displays both approved references and final production-component captures in the same image. Each control region is cropped and scaled for comparison; the enlarged sketches do not define literal application pixel sizes.
- `resources-dark-final.png`: 1280 × 720 output, 1120px preview frame, Chinese locale, shop selected, installed GitHub with both actions. Production components and styles are rendered with synthetic IPC data.
- Additional evidence: `resources-light-de-final.png` (880 × 820, long German labels), `resources-dark-narrow.png` (640 × 820), `resources-rtl-single-action.png` (980 × 820, Arabic and uninstall-only card), `keyboard-focus.png`, and `uninstall-confirmation.png`.

## Fidelity and comparison history

- Typography and assets: preserve the existing system font, localized copy and plugin artwork; reuse the gear and trash vector icons. Source metadata uses two right-aligned lines, ellipsis and full-value titles; long plugin names also retain a full-value title.
- Layout: source tabs use a 12px gap, 14px horizontal padding and pill selection without an underline. The source moves to the card heading; joined actions align at the bottom end. Compact cards retain their existing overall dimensions.
- Color: configuration uses a muted blue surface and light blue foreground; uninstall uses muted coral. Both have corresponding light-theme colors, tinted borders and hover states. Logical corner radii support RTL and leave an uninstall-only action fully rounded.
- [P2, resolved] The generic resource-button rules initially overrode the selected blue/coral surfaces. Scoped selectors now preserve the approved colors; final computed dark surfaces are `#26394d` and `#392c30`.
- [P2, resolved] Long German action labels exceeded a narrow card. The joined group now stays within the card and labels wrap with automatic hyphenation. At the 880px viewport, the 247px card contains a 213px action group without horizontal page overflow.
- Final side-by-side comparison inspected the source capsules, heading alignment, icons, joined seam, borders and colors. No remaining actionable P0/P1/P2 findings.

## Interaction and validation

- Source selection and ArrowLeft navigation select the correct tab and panel. Configure opens the existing GitHub connection dialog; Escape closes it. Uninstall opens the existing confirmation dialog; Cancel preserves the installed plugin.
- Keyboard focus remains visible over the joined seam: the uninstall action has a 2px focus outline and elevated stacking while focused.
- Wide and narrow views, both themes, long German labels and Arabic RTL render without horizontal page overflow. Single-action cards keep their rounded outline.
- Browser error/warning log is empty.
- Eight relevant test files / 183 tests passed. Desktop typecheck and production build passed; the build retains the existing large-chunk warning. Prettier, UI convergence verification, its negative fixtures and whitespace checks passed.

## Limits

- Mock IPC validates the actual renderer behavior without exercising a real account or external provider. This change has not been packaged or installed in Artemis.
- The generated references contain illustrative texture; production uses deterministic theme surfaces and existing compact typography. Pixel-identical texture is not part of this implementation.

---

# Resource removal confirmations and quiet list actions — 2026-09-19

final result: passed

## Approved reference and rendered evidence

- Approved reference: `/Users/williamji/.codex/generated_images/01a0b9ae-a9d7-7c02-b1e5-663716e3d41a/exec-7a124734-162d-4708-9b2d-aa95154f8caf.png`, 1448 × 1086 pixels.
- Native Electron evidence: `/Users/williamji/.codex/visualizations/2026/09/19/01a0b9ae-a9d7-7c02-b1e5-663716e3d41a/resource-removal-qa/`. `report.json` records final measurements, interactions and the empty runtime console issue list.
- Wide viewport: 1440 × 960 CSS pixels, device scale factor 2. `mcp-dark.png`, `mcp-hover-dark.png`, `skill-dark.png` and corresponding light-theme captures show the actual management lists.
- Dialog crops: `mcp-dialog-dark.png`, `skill-dialog-dark.png` and their light-theme counterparts. Dialogs measure 440 × 212.2 CSS pixels; the source board and final captures were opened together for comparison.
- Narrow viewport: 640 × 820 CSS pixels, device scale factor 2. `skill-dialog-narrow-light.png` and `skill-dialog-narrow-de.png` verify Chinese and longer German labels without horizontal dialog overflow.
- Evidence uses the production Electron build, an isolated temporary profile and synthetic resource IPC. Native mouse and keyboard events exercise the actual renderer.

## Fidelity and comparison history

- Typography and layout: retain the existing system font, 18px modal title, 15px resource name and 14px warning. The dialog uses 24px padding, a 36px existing resource avatar and aligned footer actions. Chinese action buttons measure 76 × 30 CSS pixels with 14px icons; translated labels expand naturally while keeping the compact height.
- Color and assets: list trash icons are neutral outlines with transparent backgrounds; hover and keyboard focus use a subtle red tint. The modal reuses the real resource artwork, the close glyph for Cancel and the trash glyph for Remove or Uninstall. Confirmation uses a subdued red surface and visible keyboard focus.
- Copy: MCP confirmation identifies the server and uses the explicit Remove action; Skill confirmation identifies the skill and uses Uninstall. The irreversible-operation warning remains visible. The dedicated MCP action label covers all 14 supported locales.
- [P2, resolved] A generic quiet-button hover rule initially overrode the red list tint. Scoped selectors now preserve the intended hover and focus colors; final native captures verify both themes.
- [P2, resolved] The first muted confirmation color lacked sufficient text contrast. The final normal/hover danger mixtures are 46%/40%; measured text contrast is 4.59:1/5.19:1 in dark theme and 6.39:1/7.17:1 in light theme.
- Final comparisons inspected list actions, avatar and name alignment, dialog hierarchy, compact icon buttons, colors and long labels. No remaining actionable P0/P1/P2 findings in this scope.

## Interaction and validation

- Cancel receives initial focus. Cancel and native Escape close the dialog without removal and restore focus to its initiating list action.
- Explicit confirmation invokes the correct mocked MCP or Skill removal once and refreshes the visible list. Tests additionally cover removal failure and retry, pending-state controls and repeated clicks.
- Nine related test files / 178 tests passed. Desktop typecheck and production build passed; the build retains its existing large-chunk warning.
- UI convergence and its negative fixtures, UI boundaries, skin conformance, Prettier and whitespace checks passed. Final native validation reports no console errors or warnings.

## Scope and limits

- The approved image is a presentation board. Production opens one interactive dialog at a time and retains Artemis navigation, list density and deterministic theme surfaces.
- Real MCP servers and installed skills were not removed during validation. This verifies local source and the isolated production renderer; it does not establish packaged installation or Windows native acceptance.
- Existing plugin dialogs and unrelated workspace changes are preserved. This task has not committed, pushed, packaged or installed Artemis.

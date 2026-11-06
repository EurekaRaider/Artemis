import { uiText } from "../../../../src/shared/i18n/ui-text.js";
import { currentLocale } from "../../../../src/main/main.js";
import { windowMaterial } from "../../../../src/main/main.js";

// Kept as a renderer script: it executes inside the isolated page, never in Node.
export function collectEvidenceScript(
  requestedSmokeView: string | undefined,
  goalReducedMotionActiveTransform: string | null,
): string {
  return `
              (() => {
                const issues = [];
                const iconSizingView = ${JSON.stringify(
                  requestedSmokeView ?? "",
                )};
                const cardHeatmapView = ${JSON.stringify(
                  requestedSmokeView ?? "",
                )};
                const inputFieldsView = ${JSON.stringify(
                  requestedSmokeView ?? "",
                )};
                const secondaryPagesView = ${JSON.stringify(
                  requestedSmokeView ?? "",
                )};
                const conversationTimelineView = ${JSON.stringify(
                  requestedSmokeView ?? "",
                )};
                const visible = (element) => {
                  const style = getComputedStyle(element);
                  return style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    element.getClientRects().length > 0;
                };
                const name = (element) => {
                  const labelledBy = element.getAttribute("aria-labelledby");
                  const labelled = labelledBy
                    ? labelledBy
                        .split(/\\s+/u)
                        .map((id) => document.getElementById(id)?.textContent ?? "")
                        .join(" ")
                    : "";
                  return (
                    element.getAttribute("aria-label") ||
                    labelled ||
                    element.textContent ||
                    element.getAttribute("title") ||
                    ""
                  ).trim();
                };
                for (const element of document.querySelectorAll(
                  "button, a[href], summary, [role='button'], [role='tab']",
                )) {
                  const role = element.getAttribute("role");
                  const rovingRoot =
                    role === "option"
                      ? element.closest("[role='listbox']")
                      : role === "tab"
                        ? element.closest("[role='tablist']")
                        : role === "gridcell"
                          ? element.closest("[role='grid']")
                        : null;
                  // Direct-choice buttons use arrow-key navigation within their
                  // shared DecisionOptions group, with exactly one Tab entry.
                  const decisionRoot = element.matches("button.decision-option")
                    ? element.closest(".decision-options[role='group']")
                    : null;
                  const decisionEntries = decisionRoot?.querySelectorAll(
                    ":scope > button.decision-option:not(:disabled)[tabindex='0']",
                  );
                  const usesDecisionRovingTabIndex = decisionEntries?.length === 1;
                  const modeRoot = role === "radio" ? element.closest('[data-artemis-component="run-mode-control"][role="radiogroup"]') : null;
                  const modeEntries = modeRoot?.querySelectorAll(':scope > button[role="radio"]:not(:disabled)[tabindex="0"]');
                  const usesModeRovingTabIndex = modeEntries?.length === 1 && modeEntries[0].getAttribute("aria-checked") === "true";

                  const usesRovingTabIndex = rovingRoot?.querySelector(
                    role === "option"
                      ? "[role='option'][tabindex='0']"
                      : role === "tab"
                        ? "[role='tab'][tabindex='0']"
                        : "[role='gridcell'][tabindex='0']",
                  );
                  if (visible(element) && !name(element)) {
                    issues.push({
                      rule: "interactive-name",
                      element: element.outerHTML.slice(0, 240),
                    });
                  }
                  if (
                    visible(element) &&
                    !(element instanceof HTMLButtonElement && element.disabled) &&
                    element.tabIndex < 0 &&
                    !usesRovingTabIndex &&
                    !usesDecisionRovingTabIndex &&
                    !usesModeRovingTabIndex
                  ) {
                    issues.push({
                      rule: "keyboard-focus",
                      element: element.outerHTML.slice(0, 240),
                    });
                  }
                }
                for (const element of document.querySelectorAll(
                  "input:not([type='hidden']), select, textarea",
                )) {
                  const labelled =
                    element.getAttribute("aria-label") ||
                    element.getAttribute("aria-labelledby") ||
                    element.labels?.length;
                  if (visible(element) && !labelled) {
                    issues.push({
                      rule: "form-label",
                      element: element.outerHTML.slice(0, 240),
                    });
                  }
                }
                for (const image of document.querySelectorAll("img")) {
                  if (!image.hasAttribute("alt")) {
                    issues.push({
                      rule: "image-alt",
                      element: image.outerHTML.slice(0, 240),
                    });
                  }
                }
                const ids = new Set();
                for (const element of document.querySelectorAll("[id]")) {
                  if (ids.has(element.id)) {
                    issues.push({ rule: "duplicate-id", element: element.id });
                  }
                  ids.add(element.id);
                }
                if (!document.documentElement.lang) {
                  issues.push({ rule: "document-language", element: "html" });
                }
                const environmentPanel = document.querySelector(
                  '[data-artemis-component="environment-panel"][data-part="root"]',
                );
                const environmentBounds = environmentPanel
                  ?.getBoundingClientRect();
                const conversation = document.querySelector(".conversation");
                const conversationBounds = conversation
                  ?.getBoundingClientRect();
                const workspace = document.querySelector(".workspace");
                const workspaceBounds = workspace?.getBoundingClientRect();
                const workspaceContent = document.querySelector(
                  ".workspace-content",
                );
                const workspaceContentBounds = workspaceContent
                  ?.getBoundingClientRect();
                const timelineScroll = document.querySelector(
                  ".timeline-scroll",
                );
                const timelineScrollBounds = timelineScroll
                  ?.getBoundingClientRect();
                const timelineContent = document.querySelector(".timeline");
                const timelineContentBounds = timelineContent
                  ?.getBoundingClientRect();
                const turnStatus = document.querySelector(".turn-status");
                const turnStatusBounds = turnStatus?.getBoundingClientRect();
                const environmentTrigger = document.querySelector(
                  '[data-artemis-component="environment-control"][data-part="trigger"]',
                );
                const environmentControls =
                  environmentTrigger?.getAttribute("aria-controls") ?? null;
                if (
                  environmentTrigger?.getAttribute("aria-expanded") === "true"
                ) {
                  const controlledEnvironmentPanel = environmentControls
                    ? document.getElementById(environmentControls)
                    : null;
                  if (
                    !environmentControls ||
                    controlledEnvironmentPanel !== environmentPanel ||
                    controlledEnvironmentPanel?.getAttribute("role") !== "dialog" ||
                    !name(controlledEnvironmentPanel)
                  ) {
                    issues.push({
                      rule: "environment-trigger-dialog-relationship",
                      element: environmentTrigger.outerHTML.slice(0, 240),
                    });
                  }
                }
                const workspaceDockResizer = document.querySelector(
                  '[data-artemis-component="workspace-dock-resizer"]',
                );
                const workspaceDockResizerBounds = workspaceDockResizer
                  ?.getBoundingClientRect();
                const workspaceDock = document.querySelector(
                  '[data-artemis-component="workspace-dock"]',
                );
                const workspaceDockBounds = workspaceDock
                  ?.getBoundingClientRect();
                const sidebarHeader = document.querySelector(".sidebar-header");
                const sidebarHeaderBounds = sidebarHeader?.getBoundingClientRect();
                const projectTree = document.querySelector(".project-tree");
                const projectTreeBounds = projectTree?.getBoundingClientRect();
                const temporaryDisclosure = document.querySelector(
                  ".temporary-conversations .project-group-select",
                );
                const temporaryList = document.querySelector(
                  "#temporary-conversation-list",
                );
                const goalBar = document.querySelector(".goal-bar");
                const goalBarBounds = goalBar?.getBoundingClientRect();
                const composer = document.querySelector(".composer");
                const composerBounds = composer?.getBoundingClientRect();
                const goalEditor = document.querySelector(
                  '[data-artemis-component="goal-editor"][data-part="root"]',
                );
                const reviewSurface = document.querySelector(
                  '[data-artemis-component="review-surface"][data-part="root"]',
                );
                const reviewToolbar = reviewSurface?.querySelector(
                  '[data-part="toolbar"]',
                );
                const reviewReader = reviewSurface?.querySelector(
                  '[data-part="reader"]',
                );
                const reviewFiles = reviewSurface?.querySelector(
                  '[data-part="files"]',
                );
                const reviewDiff = reviewSurface?.querySelector(
                  '[data-artemis-component="review-diff"][data-part="root"]',
                );
                const sourcesSurface = document.querySelector(
                  '[data-artemis-component="sources-surface"][data-part="root"]',
                );
                const environmentChecks = document.querySelector(
                  '.environment-checks-popover[data-artemis-component="popover"]',
                );
                const queuedSteerBar = document.querySelector(
                  ".queued-message-bar",
                );
                const queuedSteerEditor = document.querySelector(
                  ".queued-message-editor textarea",
                );
                const queuedSteerError = document.querySelector(
                  ".queued-message-editor-error[role='alert']",
                );
                const queuedSteerFocus = document.activeElement;
                const composerInput = document.querySelector(".composer textarea");
                const sourceImageEntry = document.querySelector(
                  "button.sources-panel-entry.attachment",
                );
                const sourceImageEntryBounds = sourceImageEntry
                  ?.getBoundingClientRect();
                const sourceImageThumbnailBounds = sourceImageEntry
                  ?.querySelector("img")
                  ?.getBoundingClientRect();
                const sourceImageTitleBounds = sourceImageEntry
                  ?.querySelector("h2")
                  ?.getBoundingClientRect();
                const sourceImagePreview = document.querySelector(
                  ".source-image-preview",
                );
                return {
                  documentLanguage: document.documentElement.lang,
                  documentDirection: document.documentElement.dir,
                  title: document.title,
                  rendererStartup: {
                    stages: ["renderer-entry", "skin-ready", "react-scheduled", "snapshot-request", "snapshot-ready", "renderer-ready"].map((stage) => {
                      const entry = performance.getEntriesByName("artemis:" + stage)[0];
                      return { stage, elapsedMs: entry ? Math.round(entry.startTime * 10) / 10 : null };
                    }),
                    navigation: performance.getEntriesByType("navigation").map((entry) => ({
                      responseEnd: entry.responseEnd,
                      domInteractive: entry.domInteractive,
                      domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
                      loadEventEnd: entry.loadEventEnd,
                    })),
                  },
                  themePreference:
                    document.documentElement.dataset.theme ?? "system",
                  resolvedTheme:
                    document.documentElement.dataset.artemisTheme ?? null,
                  contrastMode:
                    document.documentElement.dataset.artemisContrast ?? null,
                  interfaceMaterial: document.documentElement.dataset.material ?? null,
                  nativeMaterial: ${JSON.stringify(windowMaterial)},
                  chromeGeometry: {
                    sidebarWidth: document.querySelector('.sidebar')?.getBoundingClientRect().width ?? null,
                    headerHeight: document.querySelector('.workspace-header')?.getBoundingClientRect().height ?? null,
                    sidebarBackground: (() => { const node = document.querySelector('.sidebar > [data-part="main"]'); return node ? getComputedStyle(node).backgroundColor : null; })(),
                    sidebarBackdrop: (() => { const node = document.querySelector('.sidebar > [data-part="main"]'); return node ? getComputedStyle(node).backdropFilter : null; })(),
                  },
                  windowInnerWidth: window.innerWidth,
                  windowInnerHeight: window.innerHeight,
                  workspaceWidth: workspaceBounds?.width ?? null,
                  environmentPanelOpen:
                    environmentTrigger?.getAttribute("aria-expanded") === "true",
                  contextUsagePalette: [...document.querySelectorAll('.context-usage-swatch')].map((swatch) => {
                    const category = swatch.getAttribute('data-context-category');
                    const segment = [...document.querySelectorAll('.context-usage-breakdown-bar span')]
                      .find((element) => element.getAttribute('data-context-category') === category);
                    return { category, color: getComputedStyle(swatch).backgroundColor,
                      segmentColor: segment ? getComputedStyle(segment).backgroundColor : null };
                  }),
                  environmentControl: environmentTrigger
                    ? {
                        controls: environmentControls,
                        panelId: environmentPanel?.id ?? null,
                        panelRole: environmentPanel?.getAttribute("role") ?? null,
                        panelName: environmentPanel ? name(environmentPanel) : null,
                      }
                    : null,
                  workflowComponents: [
                    ...new Set(
                      [...document.querySelectorAll(
                        '[data-artemis-component="review-surface"], ' +
                          '[data-artemis-component="review-diff"], ' +
                          '[data-artemis-component="environment-control"], ' +
                          '[data-artemis-component="environment-panel"], ' +
                          '[data-artemis-component="goal-editor"], ' +
                          '[data-artemis-component="sources-surface"]',
                      )].map((element) =>
                        element.getAttribute("data-artemis-component"),
                      ),
                    ),
                  ],
                  reviewGeometry: reviewSurface
                    ? {
                        state: reviewSurface.getAttribute("data-state"),
                        root: reviewSurface.getBoundingClientRect().toJSON(),
                        toolbar: reviewToolbar?.getBoundingClientRect().toJSON() ?? null,
                        reader: reviewReader?.getBoundingClientRect().toJSON() ?? null,
                        files: reviewFiles?.getBoundingClientRect().toJSON() ?? null,
                        diffState: reviewDiff?.getAttribute("data-state") ?? null,
                        lineCount:
                          reviewDiff?.querySelectorAll('[data-part="line"]')
                            .length ?? 0,
                        lineMarkers: [
                          ...(reviewDiff?.querySelectorAll('[data-part="marker"]') ?? []),
                        ].map((marker) => marker.textContent ?? ""),
                      }
                    : null,
                  goalEditorGeometry: goalEditor
                    ? {
                        ...goalEditor.getBoundingClientRect().toJSON(),
                        state: goalEditor.getAttribute("data-state"),
                      }
                    : null,
                  sourcesGeometry: sourcesSurface
                    ? {
                        ...sourcesSurface.getBoundingClientRect().toJSON(),
                        state: sourcesSurface.getAttribute("data-state"),
                      }
                    : null,
                  environmentChecksGeometry: environmentChecks
                    ? environmentChecks.getBoundingClientRect().toJSON()
                    : null,
                  environmentCheckStatuses: [
                    ...document.querySelectorAll(
                      ".environment-check-indicator[data-status], .environment-check-status[data-status]",
                    ),
                  ].map((indicator) => indicator.getAttribute("data-status")),
                  environmentPanel: environmentBounds
                    ? {
                        visible: visible(environmentPanel),
                        top: environmentBounds.top,
                        right: environmentBounds.right,
                        bottom: environmentBounds.bottom,
                        left: environmentBounds.left,
                        width: environmentBounds.width,
                        height: environmentBounds.height,
                      }
                    : null,
                  environmentSectionHeadings: environmentPanel
                    ? [...environmentPanel.querySelectorAll(
                        ":scope > .environment-section > header > h2",
                      )]
                        .map((heading) => heading.textContent?.trim() ?? "")
                    : [],
                  environmentAgentStatuses: environmentPanel
                    ? [...environmentPanel.querySelectorAll(
                        ".environment-activity-row small",
                      )]
                        .map((status) => status.textContent?.trim() ?? "")
                    : [],
                  conversation: conversationBounds
                    ? {
                        left: conversationBounds.left,
                        right: conversationBounds.right,
                        width: conversationBounds.width,
                      }
                    : null,
                  workspaceContent: workspaceContentBounds
                    ? {
                        left: workspaceContentBounds.left,
                        right: workspaceContentBounds.right,
                        width: workspaceContentBounds.width,
                      }
                    : null,
                  timelineScroll: timelineScrollBounds
                    ? {
                        left: timelineScrollBounds.left,
                        right: timelineScrollBounds.right,
                        width: timelineScrollBounds.width,
                      }
                    : null,
                  timelineContent: timelineContentBounds
                    ? {
                        left: timelineContentBounds.left,
                        right: timelineContentBounds.right,
                        width: timelineContentBounds.width,
                      }
                    : null,
                  headerStatus: {
                    state: document.querySelector(".workspace-header .status-pill")?.className,
                    hasTimer: Boolean(document.querySelector(".workspace-header .status-pill time")),
                  },
                  decisionInTimeline: Boolean(document.querySelector(".timeline-scroll .composer-decision, [data-artemis-component=timeline-viewport] .composer-decision")),
                  composerDisabled: document.querySelector(".composer textarea")?.disabled === true,
                  failureNotice: Boolean(document.querySelector(".turn-error-banner[role=alert]")),
                  turnStatus: turnStatusBounds
                    ? {
                        left: turnStatusBounds.left,
                        right: turnStatusBounds.right,
                        width: turnStatusBounds.width,
                      }
                    : null,
                  dockTransition:
                    window.__artemisSmokeDockTransition ?? null,
                  workspaceDockInteraction:
                    window.__workspaceDockInteraction ?? null,
                  workspaceDockResizer: workspaceDockResizerBounds
                    ? {
                        left: workspaceDockResizerBounds.left,
                        right: workspaceDockResizerBounds.right,
                        width: workspaceDockResizerBounds.width,
                      }
                    : null,
                  workspaceDockVisible: workspaceDock
                    ? visible(workspaceDock)
                    : false,
                  workspaceDock: workspaceDockBounds
                    ? {
                        left: workspaceDockBounds.left,
                        right: workspaceDockBounds.right,
                        width: workspaceDockBounds.width,
                      }
                    : null,
                  sidebarHeaderBottom: sidebarHeaderBounds?.bottom ?? null,
                  projectTreeTop: projectTreeBounds?.top ?? null,
                  sidebarHeaderButtonCount:
                    sidebarHeader?.querySelectorAll("button").length ?? 0,
                  projectCreateButtonCount: document.querySelectorAll(
                    ".project-collection > .project-row > .project-new-thread",
                  ).length,
                  temporaryCreateButtonCount: document.querySelectorAll(
                    ".temporary-conversations > .project-row > .project-new-thread",
                  ).length,
                  temporaryConversationsOpen:
                    temporaryDisclosure?.getAttribute("aria-expanded") === "true",
                  temporaryConversationListVisible: temporaryList
                    ? visible(temporaryList)
                    : false,
                  goalBar: goalBarBounds
                    ? {
                        visible: visible(goalBar),
                        top: goalBarBounds.top,
                        right: goalBarBounds.right,
                        bottom: goalBarBounds.bottom,
                        left: goalBarBounds.left,
                        width: goalBarBounds.width,
                        height: goalBarBounds.height,
                      }
                    : null,
                  goalContextRow: document.querySelector('.composer-context-row')?.getBoundingClientRect().toJSON() ?? null,
                  projectMenuSurface: (() => {
                    const menu = document.querySelector('.project-menu');
                    if (!(menu instanceof HTMLElement)) return null;
                    const surface = (element) => {
                      const style = getComputedStyle(element);
                      return {
                        tag: element.tagName,
                        className: element.className,
                        backgroundColor: style.backgroundColor,
                        backdropFilter: style.backdropFilter,
                        filter: style.filter,
                        maskImage: style.maskImage,
                        clipPath: style.clipPath,
                        mixBlendMode: style.mixBlendMode,
                        willChange: style.willChange,
                        opacity: style.opacity,
                        isolation: style.isolation,
                        transform: style.transform,
                        contain: style.contain,
                        position: style.position,
                        zIndex: style.zIndex,
                      };
                    };
                    const ancestors = [];
                    for (let element = menu.parentElement; element; element = element.parentElement) {
                      ancestors.push(surface(element));
                    }
                    const first = menu.querySelector('button');
                    const bounds = first?.getBoundingClientRect();
                    const hit = bounds ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) : null;
                    return {
                      ...surface(menu),
                      ancestors,
                      media: {
                        reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
                        increasedContrast: matchMedia('(prefers-contrast: more)').matches,
                        forcedColors: matchMedia('(forced-colors: active)').matches,
                      },
                      visible: visible(menu),
                      firstItemUnobscured: Boolean(first && hit && first.contains(hit)),
                    };
                  })(),
                  composerBranchMenu: (() => {
                    const trigger = document.querySelector('.composer-context .branch-context-trigger');
                    const menu = document.querySelector('.composer-context .branch-context-menu');
                    if (!(trigger instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) return null;
                    const bounds = menu.getBoundingClientRect();
                    const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
                    const first = items[0];
                    const firstBounds = first?.getBoundingClientRect();
                    const topItem = firstBounds ? document.elementFromPoint(firstBounds.left + firstBounds.width / 2, firstBounds.top + firstBounds.height / 2) : null;
                    return {
                      trigger: trigger.getBoundingClientRect().toJSON(),
                      expanded: trigger.getAttribute('aria-expanded') === 'true',
                      outsideComposer: trigger.closest('.composer') === null,
                      menu: bounds.toJSON(),
                      visible: visible(menu),
                      withinViewport: bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight,
                      borderRadius: getComputedStyle(menu).borderRadius,
                      backgroundColor: getComputedStyle(menu).backgroundColor,
                      color: getComputedStyle(menu).color,
                      boxShadow: getComputedStyle(menu).boxShadow,
                      searchPresent: Boolean(menu.querySelector('.composer-context-search input')),
                      firstItemUnobscured: Boolean(first && topItem && first.contains(topItem)),
                      items: items.map((item) => ({
                        label: item.querySelector('strong')?.textContent?.trim(),
                        checked: item.getAttribute('aria-checked') === 'true',
                        checkVisible: Boolean(item.querySelector('i svg')),
                        height: item.getBoundingClientRect().height,
                      })),
                    };
                  })(),
                  environmentBranchMenu: (() => {
                    const menu = document.querySelector('.environment-branch-menu');
                    if (!(menu instanceof HTMLElement)) return null;
                    const style = getComputedStyle(menu);
                    const bounds = menu.getBoundingClientRect();
                    const first = menu.querySelector('[role="menuitemradio"]');
                    const firstBounds = first?.getBoundingClientRect();
                    const topItem = firstBounds ? document.elementFromPoint(firstBounds.left + firstBounds.width / 2, firstBounds.top + firstBounds.height / 2) : null;
                    return {
                      visible: visible(menu),
                      portalInBody: menu.parentElement === document.body,
                      backgroundColor: style.backgroundColor,
                      color: style.color,
                      borderRadius: style.borderRadius,
                      boxShadow: style.boxShadow,
                      withinViewport: bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight,
                      firstItemUnobscured: Boolean(first && topItem && first.contains(topItem)),
                    };
                  })(),
                  goalComposer: composerBounds
                    ? {
                        top: composerBounds.top,
                        right: composerBounds.right,
                        left: composerBounds.left,
                        width: composerBounds.width,
                      }
                    : null,
                  goalActionLabels: goalBar
                    ? [...goalBar.querySelectorAll(".goal-bar-actions button")]
                        .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim())
                    : [],
                  goalSharedComponents: goalBar
                    ? (() => {
                        const main = goalBar.querySelector(".goal-bar-main");
                        const badge = goalBar.querySelector(
                          '.goal-bar-status[data-artemis-component="badge"]',
                        );
                        const status = goalBar.querySelector(
                          '.goal-bar-progress[data-artemis-component="status"]',
                        );
                        const describe = (element) => {
                          if (!(element instanceof HTMLElement)) return null;
                          const style = getComputedStyle(element);
                          return {
                            component: element.getAttribute(
                              "data-artemis-component",
                            ),
                            state: element.getAttribute("data-state"),
                            size: element.getAttribute("data-size"),
                            tone: element.getAttribute("data-tone"),
                            variant: element.getAttribute("data-variant"),
                            secondary: element.classList.contains("goal-bar-secondary"),
                            display: style.display,
                            backgroundColor: style.backgroundColor,
                            borderColor: style.borderColor,
                            borderStyle: style.borderStyle,
                            borderWidth: style.borderWidth,
                            color: style.color,
                            fontFamily: style.fontFamily,
                            minBlockSize: style.minBlockSize,
                            inlineSize: style.inlineSize,
                            justifyContent: style.justifyContent,
                          };
                        };
                        const resolveVariant = (
                          backgroundToken,
                          colorToken,
                          borderToken,
                        ) => {
                          const probe = document.createElement("button");
                          probe.style.cssText = [
                            "position:fixed",
                            "visibility:hidden",
                            "background:var(" + backgroundToken + ")",
                            "border:var(--artemis-border-width-default) solid var(" +
                              borderToken +
                              ")",
                            "color:var(" + colorToken + ")",
                            "font-family:var(--artemis-typography-body-family)",
                            "outline:2px solid var(--artemis-color-focus-ring)",
                          ].join(";");
                          document.body.append(probe);
                          const style = getComputedStyle(probe);
                          const resolved = {
                            backgroundColor: style.backgroundColor,
                            borderColor: style.borderColor,
                            borderStyle: style.borderStyle,
                            borderWidth: style.borderWidth,
                            color: style.color,
                            fontFamily: style.fontFamily,
                            focusOutlineColor: style.outlineColor,
                            focusOutlineStyle: style.outlineStyle,
                            focusOutlineWidth: style.outlineWidth,
                          };
                          probe.remove();
                          return resolved;
                        };
                        const contractStyles = {
                          secondary: resolveVariant(
                            "--artemis-color-surface-base",
                            "--artemis-color-text-primary",
                            "--artemis-color-border-default",
                          ),
                          quiet: resolveVariant(
                            "--artemis-color-surface-sunken",
                            "--artemis-color-text-secondary",
                            "--artemis-color-border-default",
                          ),
                          danger: resolveVariant(
                            "--artemis-color-status-danger",
                            "--artemis-color-status-on-danger",
                            "--artemis-color-status-danger",
                          ),
                          selectedBackground: resolveVariant(
                            "--artemis-color-interaction-selected",
                            "--artemis-color-text-primary",
                            "--artemis-color-border-default",
                          ).backgroundColor,
                        };
                        const actionElements = [
                          ...goalBar.querySelectorAll(
                            ".goal-bar-actions button",
                          ),
                        ];
                        const focusTarget = ${JSON.stringify(
                          process.env.ARTEMIS_SMOKE_GOAL_FOCUS_PROBE === "1",
                        )}
                          ? actionElements[0]
                          : null;
                        focusTarget?.focus({
                          preventScroll: true,
                          focusVisible: true,
                        });
                        const focusStyle = focusTarget
                          ? getComputedStyle(focusTarget)
                          : null;
                        const focus = focusStyle
                          ? {
                              active:
                                document.activeElement === focusTarget,
                              outlineColor: focusStyle.outlineColor,
                              outlineStyle: focusStyle.outlineStyle,
                              outlineWidth: focusStyle.outlineWidth,
                            }
                          : null;
                        const stateProbes = (() => {
                          const source = actionElements.find((element) =>
                            element.getAttribute("data-artemis-component") === "icon-button",
                          );
                          if (!(source instanceof HTMLButtonElement)) return [];
                          const host = document.createElement("div");
                          host.style.cssText = [
                            "position:fixed",
                            "inset-block-start:0",
                            "inset-inline-start:0",
                            "display:flex",
                            "visibility:hidden",
                          ].join(";");
                          document.body.append(host);
                          const probes = [];
                          const indicatorText = {
                            ready: "",
                            selected: "✓",
                            error: "!",
                            loading: "…",
                            disabled: "",
                          };
                          for (const size of ["compact", "comfortable"]) {
                            for (const variant of [
                              "secondary",
                              "quiet",
                              "danger",
                            ]) {
                              for (const state of [
                                "ready",
                                "selected",
                                "error",
                                "loading",
                                "disabled",
                              ]) {
                                const clone = source.cloneNode(true);
                                clone.classList.remove("goal-bar-secondary");
                                clone.dataset.size = size;
                                clone.dataset.variant = variant;
                                clone.dataset.state = state;
                                clone.disabled =
                                  state === "loading" || state === "disabled";
                                const indicator = clone.querySelector(
                                  '[data-part="state-indicator"]',
                                );
                                if (indicator) {
                                  indicator.textContent = indicatorText[state];
                                }
                                host.append(clone);
                                const bounds = clone.getBoundingClientRect();
                                const iconBounds = clone
                                  .querySelector(
                                    '[data-artemis-component="icon"]',
                                  )
                                  ?.getBoundingClientRect();
                                const indicatorBounds =
                                  indicator?.getBoundingClientRect();
                                const indicatorStyle = indicator
                                  ? getComputedStyle(indicator)
                                  : null;
                                const style = getComputedStyle(clone);
                                const indicatorVisible =
                                  indicatorStyle?.display !== "none";
                                probes.push({
                                  size,
                                  variant,
                                  state,
                                  width: bounds.width,
                                  height: bounds.height,
                                  iconCenterDelta: iconBounds
                                    ? iconBounds.left + iconBounds.width / 2 -
                                      (bounds.left + bounds.width / 2)
                                    : null,
                                  indicatorVisible,
                                  indicatorOverflow:
                                    indicatorVisible && indicatorBounds
                                      ? indicatorBounds.left < bounds.left ||
                                        indicatorBounds.right > bounds.right ||
                                        indicatorBounds.top < bounds.top ||
                                        indicatorBounds.bottom > bounds.bottom
                                      : false,
                                  scrollOverflow:
                                    clone.scrollWidth > clone.clientWidth ||
                                    clone.scrollHeight > clone.clientHeight,
                                  backgroundColor: style.backgroundColor,
                                  borderColor: style.borderColor,
                                  borderStyle: style.borderStyle,
                                  borderWidth: style.borderWidth,
                                  color: style.color,
                                  fontFamily: style.fontFamily,
                                });
                                clone.remove();
                              }
                            }
                          }
                          host.remove();
                          return probes;
                        })();
                        return {
                          goalState: goalBar.getAttribute("data-goal-state"),
                          stateLabel: goalBar.getAttribute("aria-label"),
                          stateText: goalBar.querySelector(".goal-bar-status")?.textContent?.trim() ?? null,
                          completeIcon: Boolean(goalBar.querySelector(".goal-bar-complete")),
                          actionsRevealed: goalBar.matches(":hover, :focus-within"),
                          main: describe(main),
                          badge: describe(badge),
                          status: describe(status),
                          actions: actionElements.map(describe),
                          contractStyles,
                          focus,
                          stateProbes,
                        };
                      })()
                    : null,
                  goalReducedMotion: {
                    matches: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches,
                    activeTransform: ${JSON.stringify(
                      goalReducedMotionActiveTransform,
                    )},
                  },
                  goalEditorVisible: goalEditor ? visible(goalEditor) : false,
                  goalEditorValue:
                    document.querySelector(".goal-editor-input")?.value ?? null,
                  goalEditorSaveDisabled:
                    document.querySelector(
                      ".goal-editor-footer .primary-button",
                    )?.disabled ?? null,
                  goalEditorRevertDisabled:
                    document.querySelector(".goal-editor-revert")?.disabled ??
                    null,
                  goalEditorBusy:
                    goalEditor?.getAttribute("aria-busy") === "true",
                  goalEditorAlert:
                    document.querySelector(".transient-notice[role='alert']")
                      ?.textContent?.trim() ?? null,
                  goalEditorNotice: (() => {
                    const notice = document.querySelector(".transient-notice[role='alert']");
                    return notice && visible(notice)
                      ? notice.getBoundingClientRect().toJSON()
                      : null;
                  })(),
                  queuedSteer: {
                    barVisible: queuedSteerBar ? visible(queuedSteerBar) : false,
                    itemCount: document.querySelectorAll(
                      ".queued-message-item",
                    ).length,
                    editorVisible:
                      queuedSteerEditor instanceof HTMLTextAreaElement
                        ? visible(queuedSteerEditor)
                        : false,
                    editorValue:
                      queuedSteerEditor instanceof HTMLTextAreaElement
                        ? queuedSteerEditor.value
                        : null,
                    firstItemText:
                      document
                        .querySelector(
                          '[data-queued-index="0"] .queued-message-content',
                        )
                        ?.textContent?.trim() ?? null,
                    errorVisible: queuedSteerError
                      ? visible(queuedSteerError)
                      : false,
                    errorText: queuedSteerError?.textContent?.trim() ?? null,
                    retryDisabled: queuedSteerError?.querySelector("button")
                      ?.disabled ?? null,
                    focusTag: queuedSteerFocus?.tagName ?? null,
                    focusQueuedIndex:
                      queuedSteerFocus?.closest?.("[data-queued-index]")
                        ?.getAttribute("data-queued-index") ?? null,
                    focusOnFirstSteer:
                      queuedSteerFocus instanceof HTMLElement
                        ? queuedSteerFocus.matches(
                            '[data-queued-index="0"] .queued-message-steer',
                          )
                        : false,
                    genericNoticeVisible: [...document.querySelectorAll(
                      ".transient-notice",
                    )].some((notice) => visible(notice)),
                    genericNoticeCount: document.querySelectorAll(
                      ".transient-notice",
                    ).length,
                    genericNoticeText:
                      document
                        .querySelector(".transient-notice")
                        ?.textContent?.trim() ?? null,
                    actions: (() => {
                      const container = document.querySelector(
                        ".queued-message-editor-actions",
                      );
                      if (!container) {
                        return null;
                      }
                      const buttons = Array.from(
                        container.querySelectorAll("button"),
                      );
                      const style = getComputedStyle(container);
                      const bounds = container.getBoundingClientRect();
                      return {
                        present: true,
                        directChildOfEditorRoot:
                          container.parentElement ===
                          container.closest(".queued-message-editor"),
                        display: style.display,
                        flexDirection: style.flexDirection,
                        justifyContent: style.justifyContent,
                        gap: style.gap,
                        buttonCount: buttons.length,
                        buttonLabels: buttons.map((button) =>
                          (button.textContent ?? "").trim(),
                        ),
                        containerWidth: bounds.width,
                        buttonWidths: buttons.map(
                          (button) => button.getBoundingClientRect().width,
                        ),
                        buttonTops: buttons.map(
                          (button) => button.getBoundingClientRect().top,
                        ),
                      };
                    })(),
                    editTimeActions: window.__queuedSteerActions ?? null,
                    probe: window.__queuedSteerProbe ?? null,
                  },
                  markdownEditor: (() => {
                    const panel = document.querySelector(
                      '[data-artemis-component="workspace-file-layout"]',
                    );
                    const editor = panel?.querySelector(
                      '[data-artemis-component="workspace-editor-toolbar"]',
                    );
                    const toolbar = editor;
                    const status = editor?.querySelector(
                      '[data-part="status"]',
                    );
                    const save = editor?.querySelector('[data-part="save"]');
                    const alert = editor?.querySelector(
                      ':scope > [data-part="error"][role="alert"]',
                    );
                    const textarea = editor?.querySelector(
                      '[data-artemis-component="workspace-source-editor"] [data-part="source"]',
                    );
                    const sourceEditor = textarea?.closest(
                      '[data-artemis-component="workspace-source-editor"]',
                    );
                    const preview = editor?.querySelector(
                      '[data-artemis-component="workspace-preview"]',
                    );
                    const modeToggle = editor?.querySelector(
                      '[data-part="mode"] [data-artemis-component="segmented-control"]',
                    );
                    const toggleButtons = [
                      ...(modeToggle?.querySelectorAll('button') ?? []),
                    ];
                    const placeholders = [
                      ...(editor?.querySelectorAll(
                        '[data-workspace-image-failed]',
                      ) ?? []),
                    ];
                    const binaryEmpty = panel?.querySelector(
                      '[data-artemis-component="workspace-content-state"]',
                    );
                    return {
                      panelOpen: panel ? visible(panel) : false,
                      editorVisible: editor ? visible(editor) : false,
                      toolbarVisible: toolbar ? visible(toolbar) : false,
                      path:
                        panel
                          ?.querySelector(
                            '[data-artemis-component="workspace-editor-toolbar"] > [data-part="path"] > span[title], [data-artemis-component="workspace-file-header"] [data-part="path"][title]',
                          )
                          ?.getAttribute('title') ?? null,
                      statusRole: status?.getAttribute('role') ?? null,
                      statusLive: status?.getAttribute('aria-live') ?? null,
                      statusText: status?.textContent?.trim() ?? null,
                      statusDirty:
                        editor?.getAttribute('data-state') === 'dirty',
                      savePresent: save !== null,
                      saveDisabled:
                        save instanceof HTMLButtonElement
                          ? save.disabled
                          : null,
                      saveLabel: save?.textContent?.trim() ?? null,
                      alertVisible: alert ? visible(alert) : false,
                      alertText: alert?.textContent?.trim() ?? null,
                      sourceVisible:
                        textarea instanceof HTMLTextAreaElement
                          ? visible(textarea)
                          : false,
                      sourceValue:
                        textarea instanceof HTMLTextAreaElement
                          ? textarea.value
                          : null,
                      sourceValueLength:
                        textarea instanceof HTMLTextAreaElement
                          ? textarea.value.length
                          : null,
                      sourceDisabled:
                        textarea instanceof HTMLTextAreaElement
                          ? textarea.disabled
                          : null,
                      sourceLanguage:
                        sourceEditor?.getAttribute('data-language') ?? null,
                      sourceState:
                        sourceEditor?.getAttribute('data-state') ?? null,
                      sourceHighlightPresent:
                        sourceEditor?.querySelector('[data-part="highlight"]') !=
                        null,
                      previewVisible: preview ? visible(preview) : false,
                      previewHeading:
                        preview?.querySelector('h1')?.textContent?.trim() ??
                        null,
                      previewImageCount: preview
                        ? preview.querySelectorAll('img').length
                        : 0,
                      modeToggleRole:
                        modeToggle?.getAttribute('role') ?? null,
                      modeToggleLabels: toggleButtons.map((button) =>
                        (button.textContent ?? '').trim(),
                      ),
                      richPressed:
                        toggleButtons[0]?.getAttribute('aria-pressed') ?? null,
                      sourcePressed:
                        toggleButtons[1]?.getAttribute('aria-pressed') ?? null,
                      imagePlaceholders: placeholders.map((placeholder) => ({
                        role: placeholder.getAttribute('role'),
                        ariaLabel: placeholder.getAttribute('aria-label'),
                        href: placeholder.getAttribute(
                          'data-workspace-image-failed',
                        ),
                        text: placeholder.textContent?.trim() ?? null,
                        visible: visible(placeholder),
                      })),
                      readOnlyBinary: {
                        previewEmptyVisible: binaryEmpty
                          ? visible(binaryEmpty)
                          : false,
                        previewEmptyText:
                          binaryEmpty?.textContent?.trim() ?? null,
                        saveAbsent:
                          panel?.querySelector(
                            '[data-artemis-component="workspace-editor-toolbar"] [data-part="save"]',
                          ) == null,
                        statusAbsent:
                          panel?.querySelector(
                            '[data-artemis-component="workspace-editor-toolbar"] [data-part="status"]',
                          ) == null,
                        editorAbsent:
                          panel?.querySelector(
                            '[data-artemis-component="workspace-editor-toolbar"]',
                          ) == null && textarea == null,
                      },
                      focusTag: document.activeElement?.tagName ?? null,
                      statusTrace: window.__markdownEditorStatusTrace ?? null,
                      toggleProbe: window.__markdownEditorToggleProbe ?? null,
                    };
                  })(),
                  mcpEditor: (() => {
                    const editor = document.querySelector('.mcp-editor');
                    const inputByLabel = (text) => {
                      const label = [
                        ...document.querySelectorAll(
                          '.mcp-editor label[data-part="label"]',
                        ),
                      ].find(
                        (candidate) => candidate.textContent?.trim() === text,
                      );
                      return label instanceof HTMLLabelElement
                        ? label.control
                        : null;
                    };
                    const inputsByLabelPrefix = (prefix) => [
                      ...document.querySelectorAll(
                        '.mcp-editor label[data-part="label"]',
                      ),
                    ].flatMap((label) =>
                      label instanceof HTMLLabelElement &&
                      label.textContent?.trim().startsWith(prefix) &&
                      label.control instanceof HTMLInputElement
                        ? [label.control]
                        : [],
                    );
                    const validation = document.querySelector(
                      '.mcp-editor .mcp-editor-validation',
                    );
                    const actionError = document.querySelector(
                      '.mcp-editor .mcp-editor-action-error',
                    );
                    const retry = document.querySelector(
                      '.mcp-editor .mcp-editor-action-retry',
                    );
                    const busyRegion = document.querySelector(
                      '.mcp-editor .mcp-editor-busy',
                    );
                    const test = document.querySelector('.mcp-editor-test');
                    const testButton = test?.querySelector(
                      '.mcp-editor-test-button',
                    );
                    const testStatus = test?.querySelector(
                      '.mcp-editor-test-status',
                    );
                    const testFailure = test?.querySelector(
                      '.mcp-editor-test-failure',
                    );
                    const testHint = test?.querySelector(
                      '.mcp-editor-test-hint',
                    );
                    const removeButton = document.querySelector(
                      '.mcp-editor .mcp-editor-remove',
                    );
                    const saveButton = document.querySelector(
                      '.mcp-editor .mcp-editor-save',
                    );
                    const backButton = document.querySelector(
                      '.mcp-editor .mcp-editor-back',
                    );
                    const backIcon = backButton?.querySelector('svg');
                    const validationList = validation?.querySelector('ul');
                    const commandInput = inputByLabel('Launch command');
                    const urlInput = inputByLabel('Server URL');
                    const bearerInput = document.querySelector(
                      '.mcp-editor input[type="password"]',
                    );
                    const dialog = document.querySelector('.confirmation-dialog');
                    return {
                      editorVisible: editor ? visible(editor) : false,
                      direction: getComputedStyle(document.documentElement).direction,
                      backIconTransform: backIcon
                        ? getComputedStyle(backIcon).transform
                        : null,
                      validationPaddingInlineStart: validationList
                        ? getComputedStyle(validationList).paddingInlineStart
                        : null,
                      heading: editor?.querySelector('h1')?.textContent?.trim() ?? null,
                      feedbackAriaBusy:
                        document
                          .querySelector('.mcp-editor-feedback')
                          ?.getAttribute('aria-busy') ?? null,
                      busyText: busyRegion?.textContent?.trim() ?? null,
                      validationVisible: validation ? visible(validation) : false,
                      validationRole: validation?.getAttribute('role') ?? null,
                      validationText: validation?.textContent?.trim() ?? null,
                      actionErrorVisible: actionError ? visible(actionError) : false,
                      actionErrorRole: actionError?.getAttribute('role') ?? null,
                      actionErrorText: actionError?.textContent?.trim() ?? null,
                      retryPresent: retry != null,
                      retryDisabled:
                        retry instanceof HTMLButtonElement ? retry.disabled : null,
                      testPresent: test != null,
                      testAriaBusy: test?.getAttribute('aria-busy') ?? null,
                      testStatusText: testStatus?.textContent?.trim() ?? null,
                      testFailureVisible: testFailure ? visible(testFailure) : false,
                      testFailureText: testFailure?.textContent?.trim() ?? null,
                      testHintPresent: testHint != null,
                      testHintText: testHint?.textContent?.trim() ?? null,
                      testButtonDisabled:
                        testButton instanceof HTMLButtonElement
                          ? testButton.disabled
                          : null,
                      removePresent: removeButton != null,
                      removeDisabled:
                        removeButton instanceof HTMLButtonElement
                          ? removeButton.disabled
                          : null,
                      savePresent: saveButton != null,
                      saveDisabled:
                        saveButton instanceof HTMLButtonElement
                          ? saveButton.disabled
                          : null,
                      backDisabled:
                        backButton instanceof HTMLButtonElement
                          ? backButton.disabled
                          : null,
                      commandValue:
                        commandInput instanceof HTMLInputElement
                          ? commandInput.value
                          : null,
                      urlValue:
                        urlInput instanceof HTMLInputElement ? urlInput.value : null,
                      urlDisabled:
                        urlInput instanceof HTMLInputElement ? urlInput.disabled : null,
                      argsValues: inputsByLabelPrefix('Arguments ').map(
                        (input) => input.value,
                      ),
                      bearerMasked:
                        bearerInput instanceof HTMLInputElement
                          ? bearerInput.type === 'password'
                          : null,
                      confirmDialog:
                        dialog instanceof HTMLElement
                          ? {
                              visible: visible(dialog),
                              role: dialog.getAttribute('role'),
                              tone: dialog.getAttribute('class') ?? '',
                              title:
                                dialog
                                  .querySelector('#confirmation-title')
                                  ?.textContent?.trim() ?? null,
                              message:
                                dialog
                                  .querySelector('#confirmation-message')
                                  ?.textContent?.trim() ?? null,
                              cancelLabel:
                                dialog
                                  .querySelector('.secondary-button')
                                  ?.textContent?.trim() ?? null,
                              confirmLabel:
                                dialog
                                  .querySelector('.primary-button')
                                  ?.textContent?.trim() ?? null,
                              confirmDanger:
                                dialog
                                  .querySelector('.primary-button')
                                  ?.classList.contains('danger') ?? false,
                            }
                          : null,
                      manageMessageText:
                        document
                          .querySelector(
                            '.resource-management-page ' +
                              '[data-artemis-component="inline-notice"]' +
                              '[data-tone="info"] [data-part="message"]',
                          )
                          ?.textContent?.trim() ?? null,
                      manageServerNames: [
                        ...document.querySelectorAll(
                          '.resource-management-list .resource-mcp-row .resource-mcp-name',
                        ),
                      ].map((name) => name.textContent?.trim() ?? ''),
                      focusTag: document.activeElement?.tagName ?? null,
                      busyTrace: window.__mcpEditorBusyTrace ?? null,
                      probe: window.__mcpEditorProbe ?? null,
                      consoleCapture: window.__mcpEditorConsoleCapture ?? null,
                      seedRow: window.__mcpEditorSeedRow ?? null,
                      seedStdioRow: window.__mcpEditorSeedStdioRow ?? null,
                    };
                  })(),
                  messageActionLabels: [...document.querySelectorAll(
                    ".message-action",
                  )].map((button) => button.getAttribute("aria-label")),
                  composerValue:
                    composerInput instanceof HTMLTextAreaElement
                      ? composerInput.value
                      : null,
                  sourceImageEntry: sourceImageEntryBounds
                    ? {
                        label: sourceImageEntry?.getAttribute("aria-label"),
                        left: sourceImageEntryBounds.left,
                        right: sourceImageEntryBounds.right,
                        thumbnail: sourceImageThumbnailBounds
                          ? {
                              left: sourceImageThumbnailBounds.left,
                              right: sourceImageThumbnailBounds.right,
                            }
                          : null,
                        title: sourceImageTitleBounds
                          ? {
                              left: sourceImageTitleBounds.left,
                              right: sourceImageTitleBounds.right,
                            }
                          : null,
                      }
                    : null,
                  sourceImagePreview: sourceImagePreview
                    ? {
                        visible: visible(sourceImagePreview),
                        label: sourceImagePreview.getAttribute("aria-label"),
                        imageAlt:
                          sourceImagePreview
                            .querySelector("img")
                            ?.getAttribute("alt") ?? null,
                      }
                    : null,
                  goalActionGeometry: goalBar
                    ? [...goalBar.querySelectorAll(".goal-bar-actions button")]
                        .map((button) => {
                          const bounds = button.getBoundingClientRect();
                          const icon = button.querySelector("svg")
                            ?.getBoundingClientRect();
                          return {
                            height: bounds.height,
                            width: bounds.width,
                            iconHeight: icon?.height ?? null,
                            iconWidth: icon?.width ?? null,
                          };
                        })
                    : [],
                  cardHeatmap: [
                    "card-heatmap",
                    "secondary-pages-token-usage",
                  ].includes(cardHeatmapView)
                    ? (() => {
                        const summarySection = document.querySelector(
                          ".token-usage-summary",
                        );
                        const summaryItems = [
                          ...document.querySelectorAll(
                            '.token-usage-summary [data-artemis-component="data-stat"]',
                          ),
                        ];
                        const cacheHitLabel = ${JSON.stringify(uiText(currentLocale(), "token_usage_TOKEN_USAGE_COPY.cacheHitRate"))};
                        const cacheHitDescription = ${JSON.stringify(uiText(currentLocale(), "token_usage_TOKEN_USAGE_COPY.cacheHitRateDescription"))};
                        const cacheHitRate = [
                          ...document.querySelectorAll('.token-usage-details dt'),
                        ].find((label) => label.textContent?.trim() === cacheHitLabel);
                        const grid = document.querySelector(
                          '[data-artemis-component="data-heatmap"] [data-part="grid"]',
                        );
                        const cells = [
                          ...document.querySelectorAll(
                            '[data-artemis-component="data-heatmap"] [data-part="cell"]',
                          ),
                        ];
                        const rows = [
                          ...(grid?.querySelectorAll(':scope > [role="row"]') ?? []),
                        ];
                        const ownedCellCount = rows.reduce(
                          (count, row) =>
                            count +
                            [...row.children].filter(
                              (child) => child.getAttribute('role') === 'gridcell',
                            ).length,
                          0,
                        );
                        const contextCellCount = cells.filter(
                          (cell) =>
                            cell.parentElement?.getAttribute('role') === 'row' &&
                            cell.parentElement?.parentElement === grid,
                        ).length;
                        const dataLevelHistogram = {};
                        for (const cell of cells) {
                          const level = cell.getAttribute("data-level") ?? "missing";
                          dataLevelHistogram[level] =
                            (dataLevelHistogram[level] ?? 0) + 1;
                        }
                        const months = document.querySelector(
                          '[data-artemis-component="data-heatmap"] [data-part="column-labels"]',
                        );
                        const monthLabels = [
                          ...(months?.querySelectorAll("span") ?? []),
                        ];
                        // The routing branch focused today's cell and the
                        // tooltip DOM has committed, so the probe reads the
                        // focused state synchronously (a fresh .focus()
                        // here would race React's re-render).
                        const focusedCell =
                          cells.find(
                            (cell) => cell === document.activeElement,
                          ) ?? null;
                        const tooltip = focusedCell?.querySelector(
                          '[role="tooltip"]',
                        );
                        const scrollPort = grid?.closest(
                          '.token-usage-chart-scroll',
                        );
                        const geometry = (element) => {
                          const bounds = element?.getBoundingClientRect();
                          return bounds
                            ? {
                                bottom: bounds.bottom,
                                left: bounds.left,
                                right: bounds.right,
                                top: bounds.top,
                              }
                            : null;
                        };
                        const visibleWithin = (element, container) => {
                          const bounds = element?.getBoundingClientRect();
                          const port = container?.getBoundingClientRect();
                          return Boolean(
                            bounds &&
                              port &&
                              bounds.left >= Math.max(0, port.left) - 1 &&
                              bounds.right <=
                                Math.min(window.innerWidth, port.right) + 1 &&
                              bounds.top >= Math.max(0, port.top) - 1 &&
                              bounds.bottom <=
                                Math.min(window.innerHeight, port.bottom) + 1,
                          );
                        };
                        const focusTooltipProbe = {
                          focused: focusedCell !== null,
                          tooltipRolePresent: tooltip != null,
                          cellWithinScrollPort: visibleWithin(
                            focusedCell,
                            scrollPort,
                          ),
                          tooltipWithinScrollPort: visibleWithin(
                            tooltip,
                            scrollPort,
                          ),
                          cellGeometry: geometry(focusedCell),
                          tooltipGeometry: geometry(tooltip),
                          scrollPortGeometry: geometry(scrollPort),
                        };
                        return {
                          view: cardHeatmapView,
                          summary: {
                            present: summarySection !== null,
                            className: summarySection?.getAttribute("class"),
                            ariaLabel:
                              summarySection?.getAttribute("aria-label") ?? null,
                            itemCount: summaryItems.length,
                            items: summaryItems.map((item) => ({
                              value:
                                item.querySelector("strong")?.textContent ?? null,
                              label:
                                item.querySelector("span")?.textContent ?? null,
                              itemClassName: item.getAttribute("class"),
                            })),
                          },
                          cacheInsight: {
                            present: cacheHitRate != null,
                            label: cacheHitRate?.textContent?.trim() ?? null,
                            value: cacheHitRate?.nextElementSibling?.textContent?.trim() ?? null,
                            description: cacheHitRate?.getAttribute('title') ?? null,
                            descriptionMatches:
                              cacheHitRate?.getAttribute('title') === cacheHitDescription,
                          },
                          heatmap: {
                            gridPresent: grid !== null,
                            gridClassName: grid?.getAttribute("class"),
                            gridRole: grid?.getAttribute("role") ?? null,
                            gridAriaLabel:
                              grid?.getAttribute("aria-label") ?? null,
                            rowCount: rows.length,
                            rowRole: rows[0]?.getAttribute("role") ?? null,
                            ownedCellCount,
                            contextCellCount,
                            cellCount: cells.length,
                            cellRole: cells[0]?.getAttribute("role") ?? null,
                            cellTagName:
                              cells[0]?.tagName.toLowerCase() ?? null,
                            labelledCellCount: cells.filter(
                              (cell) =>
                                (cell.getAttribute("aria-label") ?? "")
                                  .trim().length > 0,
                            ).length,
                            distinctCellLabelCount: new Set(
                              cells.map((cell) =>
                                cell.getAttribute("aria-label"),
                              ),
                            ).size,
                            tabStopCount: cells.filter(
                              (cell) => cell.getAttribute("tabindex") === "0",
                            ).length,
                            dataLevelHistogram,
                            monthContainerAriaHidden:
                              months?.getAttribute("aria-hidden") ?? null,
                            monthLabelCount: monthLabels.length,
                            monthLabels: monthLabels.map((label) => label.textContent),
                            focusTooltipProbe,
                          },
                        };
                      })()
                    : null,
                  secondaryPages: secondaryPagesView.startsWith(
                    "secondary-pages-",
                  )
                    ? (() => {
                        const rootSelector = {
                          "secondary-pages-archive": ".archive-page",
                          "secondary-pages-token-usage": ".token-usage-page",
                          "secondary-pages-automations": ".automation-page",
                        }[secondaryPagesView];
                        const root = rootSelector
                          ? document.querySelector(rootSelector)
                          : null;
                        const rootBounds = root?.getBoundingClientRect();
                        const headerActions = secondaryPagesView === "secondary-pages-automations"
                          ? document.querySelector(".management-header-action")
                          : null;
                        const publicComponentCount = (component) => {
                          const selector =
                            '[data-artemis-component="' + component + '"]';
                          return (
                            (root?.matches(selector) ? 1 : 0) +
                            (root?.querySelectorAll(selector).length ?? 0) +
                            (headerActions?.querySelectorAll(selector).length ?? 0)
                          );
                        };
                        return {
                          view: secondaryPagesView,
                          root: root
                            ? {
                                ariaBusy: root.getAttribute("aria-busy"),
                                ariaLabel: root.getAttribute("aria-label"),
                                component:
                                  root.getAttribute("data-artemis-component"),
                                role: root.getAttribute("role"),
                                state: root.getAttribute("data-state"),
                                geometry: rootBounds
                                  ? {
                                      bottom: rootBounds.bottom,
                                      height: rootBounds.height,
                                      left: rootBounds.left,
                                      right: rootBounds.right,
                                      top: rootBounds.top,
                                      width: rootBounds.width,
                                    }
                                  : null,
                              }
                            : null,
                          viewport: {
                            bodyScrollWidth: document.body.scrollWidth,
                            documentScrollWidth:
                              document.documentElement.scrollWidth,
                            horizontalOverflow:
                              document.documentElement.scrollWidth >
                                window.innerWidth + 1 ||
                              document.body.scrollWidth > window.innerWidth + 1,
                            innerHeight: window.innerHeight,
                            innerWidth: window.innerWidth,
                          },
                          theme: {
                            colorScheme:
                              getComputedStyle(document.documentElement)
                                .colorScheme,
                            canvas:
                              getComputedStyle(document.documentElement)
                                .getPropertyValue("--artemis-color-canvas")
                                .trim(),
                            textPrimary:
                              getComputedStyle(document.documentElement)
                                .getPropertyValue(
                                  "--artemis-color-text-primary",
                                )
                                .trim(),
                          },
                          components: {
                            button: publicComponentCount("button"),
                            iconButton: publicComponentCount("icon-button"),
                            dataHeatmap: publicComponentCount("data-heatmap"),
                            dataStat: publicComponentCount("data-stat"),
                            dataSurface: publicComponentCount("data-surface"),
                            emptyState: publicComponentCount("empty-state"),
                            managementCard:
                              publicComponentCount("management-card"),
                            managementHeader:
                              publicComponentCount("management-header"),
                            searchField: publicComponentCount("search-field"),
                            select: publicComponentCount("select"),
                            status: publicComponentCount("status"),
                          },
                          archive:
                            secondaryPagesView === "secondary-pages-archive"
                              ? {
                                  cardCount:
                                    root?.querySelectorAll(".archive-card")
                                      .length ?? 0,
                                  emptyVisible: Boolean(
                                    root?.querySelector(
                                      '[data-artemis-component="empty-state"]',
                                    ),
                                  ),
                                  searchPresent: Boolean(
                                    root?.querySelector(
                                      '[data-artemis-component="search-field"]',
                                    ),
                                  ),
                                }
                              : null,
                          automations:
                            secondaryPagesView ===
                            "secondary-pages-automations"
                              ? {
                                  heading: (() => {
                                    const heading = root?.querySelector(".automation-header h1");
                                    if (!heading) return null;
                                    const bounds = heading.getBoundingClientRect();
                                    return {
                                      width: bounds.width,
                                      height: bounds.height,
                                      lineHeight: Number.parseFloat(getComputedStyle(heading).lineHeight),
                                    };
                                  })(),
                                  headerCreateAction: (() => {
                                    const buttons = [...(headerActions?.querySelectorAll(".automation-create-button") ?? [])];
                                    const button = buttons[0];
                                    return {
                                      count: buttons.length,
                                      publicButton: button?.getAttribute("data-artemis-component") === "button",
                                      visible: Boolean(button?.checkVisibility({ visibilityProperty: true })),
                                      accessibleName: button?.getAttribute("aria-label")?.trim() || button?.textContent?.trim() || null,
                                    };
                                  })(),
                                  cardCount:
                                    root?.querySelectorAll(".automation-card")
                                      .length ?? 0,
                                  statusWithinCard: (() => {
                                    const card = root?.querySelector(
                                      ".automation-card",
                                    );
                                    const status = root?.querySelector(
                                      ".automation-state",
                                    );
                                    const cardBounds =
                                      card?.getBoundingClientRect();
                                    const statusBounds =
                                      status?.getBoundingClientRect();
                                    return cardBounds && statusBounds
                                      ? statusBounds.left >=
                                          cardBounds.left - 1 &&
                                          statusBounds.right <=
                                            cardBounds.right + 1 &&
                                          statusBounds.top >=
                                            cardBounds.top - 1 &&
                                          statusBounds.bottom <=
                                            cardBounds.bottom + 1
                                      : false;
                                  })(),
                                  longName:
                                    root
                                      ?.querySelector(
                                        ".automation-card-heading h2",
                                      )
                                      ?.textContent?.trim() ?? null,
                                  projectFilterPresent: Boolean(
                                    root?.querySelector(
                                      ".automation-project-filter" +
                                        '[data-artemis-component="select"]',
                                    ),
                                  ),
                                  moreActionsPresent: (() => {
                                    const button = root?.querySelector(
                                      '.automation-actions [data-artemis-component="icon-button"]',
                                    );
                                    return (
                                      button?.tagName === "BUTTON" &&
                                      Boolean(button.getAttribute("aria-label")?.trim()) &&
                                      button.getAttribute("aria-expanded") === "false"
                                    );
                                  })(),
                                }
                              : null,
                        };
                      })()
                    : null,
                  iconSizing: iconSizingView.startsWith("icon-sizing-")
                    ? (() => {
                        const measure = (selector) => {
                          const elements = [...document.querySelectorAll(selector)];
                          const first = elements[0] ?? null;
                          if (!first) {
                            return { selector, count: 0, sample: null };
                          }
                          const rect = first.getBoundingClientRect();
                          const style = getComputedStyle(first);
                          return {
                            selector,
                            count: elements.length,
                            sample: {
                              tagName: first.tagName.toLowerCase(),
                              className: first.getAttribute("class"),
                              attributeWidth: first.getAttribute("width"),
                              attributeHeight: first.getAttribute("height"),
                              viewBox: first.getAttribute("viewBox"),
                              rectWidth: Math.round(rect.width * 100) / 100,
                              rectHeight: Math.round(rect.height * 100) / 100,
                              computedWidth: style.width,
                              computedHeight: style.height,
                            },
                          };
                        };
                        // .resource-avatar svg is the non-semantic fallback
                        // rule; no current consumer renders a bare svg inside
                        // an avatar, so measure the rule's applied size with
                        // a temporary probe element instead of the UI.
                        const probeAvatarFallback = () => {
                          const host = document.createElement("span");
                          host.className = "resource-avatar";
                          const svg = document.createElementNS(
                            "http://www.w3.org/2000/svg",
                            "svg",
                          );
                          host.appendChild(svg);
                          document.body.appendChild(host);
                          try {
                            const rect = svg.getBoundingClientRect();
                            const style = getComputedStyle(svg);
                            return {
                              selector: "css-probe .resource-avatar svg",
                              count: 1,
                              sample: {
                                tagName: "svg",
                                className: null,
                                attributeWidth: null,
                                attributeHeight: null,
                                viewBox: null,
                                origin: "css-probe",
                                rectWidth: Math.round(rect.width * 100) / 100,
                                rectHeight:
                                  Math.round(rect.height * 100) / 100,
                                computedWidth: style.width,
                                computedHeight: style.height,
                              },
                            };
                          } finally {
                            host.remove();
                          }
                        };
                        return {
                          view: iconSizingView,
                          targets: {
                            "environment-row-icon": measure(
                              ".environment-row-icon svg:not(.child-agent-mark)",
                            ),
                            "environment-header-action": measure(
                              ".environment-section .environment-header-action svg",
                            ),
                            "environment-chevron": measure(
                              ".environment-chevron svg",
                            ),
                            "environment-external": measure(
                              ".environment-check-list i svg",
                            ),
                            "environment-branch-search": measure(
                              ".environment-branch-search > svg",
                            ),
                            "environment-branch-list-check": measure(
                              ".environment-branch-list button i svg",
                            ),
                            "environment-branch-actions": measure(
                              ".environment-branch-actions > button > svg",
                            ),
                            "environment-git-destination-chevron": measure(
                              ".environment-git-destination-trigger > svg:last-of-type",
                            ),
                            "resource-avatar-semantic": measure(
                              ".resource-avatar .resource-semantic-icon",
                            ),
                            "resource-search-field": measure(
                              ".resource-search-field svg",
                            ),
                            "resource-discovery-search": measure(
                              '.resource-discovery-panel [data-artemis-component="search-field"] svg',
                            ),
                            "resource-add-plugin-card": measure(
                              ".resource-add-plugin-card button svg",
                            ),
                            "resource-avatar-fallback": probeAvatarFallback(),
                          },
                        };
                      })()
                    : null,
                  inputFields: inputFieldsView.startsWith("input-fields-")
                    ? (() => {
                        const probe = window.__inputFieldsProbe ?? null;
                        const avatarInput = document.querySelector(
                          ".profile-avatar-input",
                        );
                        const avatarLabel =
                          avatarInput?.nextElementSibling?.matches(
                            '[data-artemis-component="button"]',
                          )
                            ? avatarInput.nextElementSibling
                            : null;
                        const avatarStyle = avatarInput
                          ? getComputedStyle(avatarInput)
                          : null;
                        const labelStyle = avatarLabel
                          ? getComputedStyle(avatarLabel)
                          : null;
                        const previewImage = document.querySelector(
                          ".settings-profile-avatar-preview img",
                        );
                        return {
                          view: inputFieldsView,
                          probe,
                          avatar: avatarInput
                            ? {
                                accept: avatarInput.getAttribute("accept"),
                                type: avatarInput.type,
                                disabled: avatarInput.disabled,
                                srOnly: {
                                  display: avatarStyle?.display ?? null,
                                  position: avatarStyle?.position ?? null,
                                  clipPath: avatarStyle?.clipPath ?? null,
                                  overflow: avatarStyle?.overflow ?? null,
                                  width: avatarStyle?.width ?? null,
                                  height: avatarStyle?.height ?? null,
                                  whiteSpace: avatarStyle?.whiteSpace ?? null,
                                },
                                geometry: {
                                  offsetParentPresent:
                                    avatarInput.offsetParent !== null,
                                  offsetWidth: avatarInput.offsetWidth,
                                  offsetHeight: avatarInput.offsetHeight,
                                },
                                tabIndex: avatarInput.tabIndex,
                                labelTagName:
                                  avatarLabel?.tagName.toLowerCase() ?? null,
                                labelClass:
                                  avatarLabel?.getAttribute("class") ?? null,
                                labelCurrentOutline: {
                                  style: labelStyle?.outlineStyle ?? null,
                                  width: labelStyle?.outlineWidth ?? null,
                                  color: labelStyle?.outlineColor ?? null,
                                },
                                previewImagePresent: previewImage !== null,
                                previewImageSrcPrefix: (
                                  previewImage?.getAttribute("src") ?? ""
                                ).slice(0, 22),
                                removePresent:
                                  document.querySelector(
                                    ".settings-profile-avatar-actions button",
                                  ) !== null,
                              }
                            : null,
                          automationDialogPresent:
                            document.querySelector(".automation-dialog") !==
                            null,
                        };
                      })()
                    : null,
                  navigationControls: (() => {
                    const roots = [
                      ...document.querySelectorAll(
                        '[data-artemis-component="tabs"], ' +
                          '[data-artemis-component="segmented-control"], ' +
                          '[data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="icon-button"]',
                      ),
                    ];
                    const describe = (root) => {
                      const rootBounds = root.getBoundingClientRect();
                      const rootStyle = getComputedStyle(root);
                      const buttons = (root instanceof HTMLButtonElement
                        ? [root]
                        : [...root.querySelectorAll('button')]).map(
                        (button) => {
                          const bounds = button.getBoundingClientRect();
                          const style = getComputedStyle(button);
                          const controlledPanelId =
                            button.getAttribute('aria-controls');
                          const controlledPanel = controlledPanelId
                            ? document.getElementById(controlledPanelId)
                            : null;
                          return {
                            id: button.id,
                            label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
                            part: button.getAttribute('data-part'),
                            state: button.getAttribute('data-state'),
                            role: button.getAttribute('role'),
                            ariaControls: button.getAttribute('aria-controls'),
                            ariaPressed: button.getAttribute('aria-pressed'),
                            ariaSelected: button.getAttribute('aria-selected'),
                            disabled: button.disabled,
                            tabIndex: button.tabIndex,
                            documentActive: document.activeElement === button,
                            controlledPanel:
                              controlledPanel === null
                                ? null
                                : {
                                    id: controlledPanel.id,
                                    role: controlledPanel.getAttribute('role'),
                                    ariaLabelledBy:
                                      controlledPanel.getAttribute(
                                        'aria-labelledby',
                                      ),
                                    hidden: controlledPanel.hidden,
                                  },
                            geometry: {
                              width: bounds.width,
                              height: bounds.height,
                            },
                            computed: {
                              backgroundColor: style.backgroundColor,
                              borderBlockEndColor: style.borderBlockEndColor,
                              borderStyle: style.borderStyle,
                              borderWidth: style.borderWidth,
                              color: style.color,
                              fontFamily: style.fontFamily,
                              fontWeight: style.fontWeight,
                              minBlockSize: style.minBlockSize,
                              opacity: style.opacity,
                              outlineColor: style.outlineColor,
                              outlineStyle: style.outlineStyle,
                              outlineWidth: style.outlineWidth,
                            },
                          };
                        },
                      );
                      return {
                        component: root.getAttribute(
                          'data-artemis-component',
                        ),
                        context: root.closest('.token-usage-page')
                          ? 'token-usage'
                          : root.closest(
                                '[data-artemis-component="workspace-file-layout"]',
                              )
                            ? 'workspace-editor'
                            : root.closest(
                                  '[data-artemis-component="workspace-tab-pane"]',
                                )
                              ? 'markdown-reader'
                              : 'other',
                        state: root.getAttribute('data-state'),
                        size: root.getAttribute('data-size'),
                        className: root.getAttribute('class'),
                        groupLabel: root.getAttribute('aria-label'),
                        role: root.getAttribute('role') ?? (root instanceof HTMLButtonElement ? 'button' : null),
                        geometry: {
                          width: rootBounds.width,
                          height: rootBounds.height,
                        },
                        computed: {
                          backgroundColor: rootStyle.backgroundColor,
                          borderStyle: rootStyle.borderStyle,
                          borderWidth: rootStyle.borderWidth,
                          color: rootStyle.color,
                          display: rootStyle.display,
                          fontFamily: rootStyle.fontFamily,
                        },
                        parts: [
                          'root',
                          ...Array.from(root.querySelectorAll('[data-part]'),
                            (part) => part.getAttribute('data-part')),
                        ],
                        buttons,
                        portalCount:
                          root.querySelectorAll('[data-artemis-portal]').length,
                      };
                    };
                    return {
                      interaction:
                        window.__navigationControlsInteraction ?? null,
                      documentHasFocus: document.hasFocus(),
                      components: roots.map(describe),
                      rootTokens: {
                        surfaceBase: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-surface-base')
                          .trim(),
                        textPrimary: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-text-primary')
                          .trim(),
                      },
                    };
                  })(),
                  formControls: (() => {
                    const roots = [
                      ...document.querySelectorAll(
                        '[data-artemis-component="text-field"], ' +
                          '[data-artemis-component="search-field"], ' +
                          '[data-artemis-component="select"], ' +
                          '[data-artemis-component="checkbox"], ' +
                          '[data-artemis-component="switch"], [data-artemis-component="run-mode-control"], [data-artemis-component="segmented-control"]',
                      ),
                    ];
                    const describe = (root) => {
                      const control = root.querySelector(
                        '[data-part="control"], [data-part="trigger"], [role="radio"][aria-checked="true"], [data-part="segment"][aria-pressed="true"]',
                      );
                      const visual =
                        root.querySelector(
                          '[data-part="track"], [data-part="indicator"]',
                        ) ?? control;
                      const style = visual ? getComputedStyle(visual) : null;
                      const focusStyle = control
                        ? getComputedStyle(control)
                        : null;
                      const bounds = root.getBoundingClientRect();
                      const menu = root.querySelector('[data-part="menu"]');
                      const menuStyle = menu ? getComputedStyle(menu) : null;
                      const menuBounds = menu?.getBoundingClientRect() ?? null;
                      return {
                        component: root.getAttribute(
                          'data-artemis-component',
                        ),
                        context: root.closest('.composer-run-modes')
                          ? 'composer'
                          : root.closest('.review-scope-select')
                            ? 'review'
                            : root.closest('.mcp-editor')
                              ? 'mcp-editor'
                              : root.closest('.settings-panel')
                                ? 'settings'
                                : root.closest('.archive-page')
                                  ? 'archive'
                                  : root.closest('.resource-page')
                                    ? 'resource'
                                    : 'other',
                        state: root.getAttribute('data-state'),
                        size: root.getAttribute('data-size'),
                        className: root.getAttribute('class'),
                        parts: [
                          'root',
                          ...[
                            ...root.querySelectorAll('[data-part]'),
                          ].map((part) => part.getAttribute('data-part')),
                        ],
                        geometry: {
                          width: bounds.width,
                          height: bounds.height,
                        },
                        control: control
                          ? {
                              tagName: control.tagName.toLowerCase(),
                              type: control.getAttribute('type'),
                              role: control.getAttribute('role'),
                              ariaInvalid:
                                control.getAttribute('aria-invalid'),
                              ariaExpanded:
                                control.getAttribute('aria-expanded'),
                              disabled:
                                control instanceof HTMLInputElement ||
                                control instanceof HTMLButtonElement
                                  ? control.disabled
                                  : null,
                              checked:
                                control instanceof HTMLInputElement
                                  ? control.checked
                                  : null,
                              value:
                                control instanceof HTMLInputElement
                                  ? control.value
                                  : null,
                              tabIndex:
                                control instanceof HTMLElement
                                  ? control.tabIndex
                                  : null,
                              documentActive:
                                document.activeElement === control,
                            }
                          : null,
                        computed: style
                          ? {
                              backgroundColor: style.backgroundColor,
                              borderColor: style.borderColor,
                              borderStyle: style.borderStyle,
                              borderWidth: style.borderWidth,
                              color: style.color,
                              fontFamily: style.fontFamily,
                              minBlockSize: style.minBlockSize,
                              opacity: style.opacity,
                            }
                          : null,
                        focus: focusStyle
                          ? {
                              outlineColor: focusStyle.outlineColor,
                              outlineStyle: focusStyle.outlineStyle,
                              outlineWidth: focusStyle.outlineWidth,
                              visualOutlineColor: style?.outlineColor ?? null,
                              visualOutlineStyle: style?.outlineStyle ?? null,
                              visualOutlineWidth: style?.outlineWidth ?? null,
                          }
                          : null,
                        menu:
                          menuBounds && menuStyle
                            ? {
                                geometry: {
                                  left: menuBounds.left,
                                  right: menuBounds.right,
                                  top: menuBounds.top,
                                  bottom: menuBounds.bottom,
                                  width: menuBounds.width,
                                  height: menuBounds.height,
                                },
                                inlineStartDelta: Math.abs(
                                  menuBounds.left - bounds.left,
                                ),
                                inlineEndDelta: Math.abs(
                                  menuBounds.right - bounds.right,
                                ),
                                overflowX: menuStyle.overflowX,
                                overflowY: menuStyle.overflowY,
                                listboxOverflowY:
                                  menu.querySelector('[data-part="listbox"]')
                                    ? getComputedStyle(
                                        menu.querySelector(
                                          '[data-part="listbox"]',
                                        ),
                                      ).overflowY
                                    : null,
                                backgroundColor: menuStyle.backgroundColor,
                                borderStyle: menuStyle.borderStyle,
                                borderWidth: menuStyle.borderWidth,
                                withinViewport:
                                  menuBounds.left >= 0 &&
                                  menuBounds.right <= window.innerWidth &&
                                  menuBounds.top >= 0 &&
                                  menuBounds.bottom <= window.innerHeight,
                                zIndex: menuStyle.zIndex,
                              }
                            : null,
                        portalCount:
                          root.querySelectorAll('[data-artemis-portal]').length,
                      };
                    };
                    return {
                      interaction: window.__formControlsInteraction ?? null,
                      documentHasFocus: document.hasFocus(),
                      forcedColors: matchMedia('(forced-colors: active)').matches,
                      components: roots.map(describe),
                      rootTokens: {
                        focusRing: getComputedStyle(document.documentElement)
                          .getPropertyValue('--artemis-color-focus-ring')
                          .trim(),
                        surfaceBase: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-surface-base')
                          .trim(),
                        textPrimary: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-text-primary')
                          .trim(),
                      },
                    };
                  })(),
                  workRecordRows: [...document.querySelectorAll('.tool-card')].map(root => ({
                    columns: getComputedStyle(root).gridTemplateColumns.split(' '),
                    gap: getComputedStyle(root).columnGap,
                    rowHeight: root.querySelector(':scope > [data-part="icon"]')?.getBoundingClientRect().height,
                    statusSize: root.querySelector('.tool-step-status svg') ? Number.parseFloat(getComputedStyle(root.querySelector('.tool-step-status svg')).width) : null,
                    targetWrap: root.querySelector('.tool-step-target') ? getComputedStyle(root.querySelector('.tool-step-target')).whiteSpace : null,
                  })),
                  conversationTimeline:
                    conversationTimelineView.startsWith(
                      'conversation-timeline-',
                    )
                      ? (() => {
                          const componentNames = [
                            'conversation-surface',
                            'timeline-viewport',
                            'timeline',
                            'timeline-turn',
                            'conversation-message',
                            'conversation-empty-state',
                            'turn-execution-disclosure',
                            'turn-change-summary',
                            'queued-message-group',
                            'queued-message-item',
                            'tool-activity',
                            'task-plan',
                            'user-input',
                            'agent-activity',
                            'turn-status',
                          ];
                          const roots = [
                            ...document.querySelectorAll(
                              componentNames
                                .map(
                                  (component) =>
                                    '[data-artemis-component="' +
                                    component +
                                    '"]',
                                )
                                .join(', '),
                            ),
                          ];
                          const describe = (root) => {
                            const bounds = root.getBoundingClientRect();
                            const style = getComputedStyle(root);
                            return {
                              component: root.getAttribute(
                                'data-artemis-component',
                              ),
                              tagName: root.tagName.toLowerCase(),
                              state: root.getAttribute('data-state'),
                              messageKind:
                                root.getAttribute('data-message-kind'),
                              role: root.getAttribute('role'),
                              ariaLabel: root.getAttribute('aria-label'),
                              open:
                                root instanceof HTMLDetailsElement
                                  ? root.open
                                  : null,
                              parts: [
                                'root',
                                ...root.querySelectorAll('[data-part]'),
                              ].map((part) =>
                                typeof part === 'string'
                                  ? part
                                  : part.getAttribute('data-part'),
                              ),
                              geometry: {
                                left: bounds.left,
                                right: bounds.right,
                                top: bounds.top,
                                bottom: bounds.bottom,
                                width: bounds.width,
                                height: bounds.height,
                              },
                              contentFitsInline:
                                root.scrollWidth <= root.clientWidth + 1,
                              visible: root.checkVisibility({
                                checkOpacity: true,
                                checkVisibilityCSS: true,
                              }),
                              computed: {
                                contentVisibility: style.contentVisibility,
                                direction: style.direction,
                                display: style.display,
                                overflowX: style.overflowX,
                                overflowY: style.overflowY,
                              },
                            };
                          };
                          const viewport = document.querySelector(
                            '[data-artemis-component="timeline-viewport"]',
                          );
                          const timeline = document.querySelector(
                            '[data-artemis-component="timeline"]',
                          );
                          const userMessage = document.querySelector(
                            '[data-artemis-component="conversation-message"]' +
                              '[data-message-kind="user"]',
                          );
                          const timelineBounds =
                            timeline?.getBoundingClientRect();
                          const viewportBounds =
                            viewport?.getBoundingClientRect();
                          const userBounds = userMessage?.getBoundingClientRect();
                          const direction = getComputedStyle(
                            document.documentElement,
                          ).direction;
                          const inlineEndGap =
                            timelineBounds && userBounds
                              ? direction === 'rtl'
                                ? userBounds.left - timelineBounds.left
                                : timelineBounds.right - userBounds.right
                              : null;
                          const horizontalOverflow = timeline
                            ? [...timeline.querySelectorAll('*')]
                                .filter((candidate) => {
                                  // SVG descendants use SVG coordinates, not CSS box overflow.
                                  // Keep checking the outer SVG viewport and its HTML container.
                                  if (candidate instanceof SVGElement && candidate.ownerSVGElement) {
                                    return false;
                                  }
                                  const style = getComputedStyle(candidate);
                                  return (
                                    candidate.scrollWidth >
                                      candidate.clientWidth + 1 &&
                                    style.overflowX !== 'auto' &&
                                    style.overflowX !== 'scroll' &&
                                    style.overflowX !== 'hidden' &&
                                    style.overflowX !== 'clip' &&
                                    style.textOverflow !== 'ellipsis'
                                  );
                                })
                                .map((candidate) => ({
                                  tagName: candidate.tagName.toLowerCase(),
                                  className: candidate.getAttribute('class'),
                                  component: candidate.getAttribute(
                                    'data-artemis-component',
                                  ),
                                  part: candidate.getAttribute('data-part'),
                                  clientWidth: candidate.clientWidth,
                                  scrollWidth: candidate.scrollWidth,
                                }))
                                .slice(0, 20)
                            : [];
                          return {
                            view: conversationTimelineView,
                            direction,
                            devicePixelRatio: window.devicePixelRatio,
                            interaction:
                              window.__conversationTimelineInteraction ?? null,
                            components: roots.map(describe),
                            toolItemStates: [
                              ...document.querySelectorAll(
                                '.tool-activity-list .tool-item-status[data-state]',
                              ),
                            ].map((item) => item.getAttribute('data-state')),
                            componentCounts: Object.fromEntries(
                              componentNames.map((component) => [
                                component,
                                roots.filter(
                                  (root) =>
                                    root.getAttribute(
                                      'data-artemis-component',
                                    ) === component,
                                ).length,
                              ]),
                            ),
                            thinkingLeak: document.body.innerText.includes(
                              'ARTEMIS_PRIVATE_THINKING_MUST_STAY_HIDDEN',
                            ),
                            horizontalOverflow,
                            timelineFitsViewport:
                              !timeline ||
                              timeline.scrollWidth <= timeline.clientWidth + 1,
                            inlineEndGap,
                            visibleDecisionPixels: (() => {
                              const bounds = document.querySelector('.timeline-decision .decision-card')?.getBoundingClientRect();
                              return bounds && viewportBounds ? Math.max(0, Math.min(bounds.bottom, viewportBounds.bottom) - Math.max(bounds.top, viewportBounds.top)) : 0;
                            })(),
                            visibleMessageCount: viewportBounds
                              ? roots.filter((root) => {
                                  if (
                                    root.getAttribute(
                                      'data-artemis-component',
                                    ) !== 'conversation-message'
                                  ) {
                                    return false;
                                  }
                                  const bounds = root.getBoundingClientRect();
                                  return (
                                    bounds.bottom > viewportBounds.top + 1 &&
                                    bounds.top < viewportBounds.bottom - 1
                                  );
                                }).length
                              : 0,
                            visibleMessagePixels: viewportBounds
                              ? Math.max(
                                  0,
                                  ...roots
                                    .filter(
                                      (root) =>
                                        root.getAttribute(
                                          'data-artemis-component',
                                        ) === 'conversation-message',
                                    )
                                    .map((root) => {
                                      const bounds =
                                        root.getBoundingClientRect();
                                      return (
                                        Math.min(
                                          bounds.bottom,
                                          viewportBounds.bottom,
                                        ) -
                                        Math.max(
                                          bounds.top,
                                          viewportBounds.top,
                                        )
                                      );
                                    }),
                                )
                              : 0,
                            viewport:
                              viewport instanceof HTMLElement
                                ? {
                                    parent: viewport.parentElement ? {
                                      ...describe(viewport.parentElement),
                                      className: viewport.parentElement.className,
                                    } : null,
                                    header: document.querySelector('.workspace-header')
                                      ? describe(document.querySelector('.workspace-header'))
                                      : null,
                                    parentComponent: viewport.parentElement?.getAttribute(
                                      'data-artemis-component',
                                    ) ?? null,
                                    clientHeight: viewport.clientHeight,
                                    clientWidth: viewport.clientWidth,
                                    scrollHeight: viewport.scrollHeight,
                                    scrollLeft: viewport.scrollLeft,
                                    scrollTop: viewport.scrollTop,
                                    scrollWidth: viewport.scrollWidth,
                                    overflowY:
                                      getComputedStyle(viewport).overflowY,
                                  }
                                : null,
                            taskPlanPresent:
                              document.querySelector(
                                '[data-artemis-component="task-plan"]',
                              ) !== null,
                            queueEditorPresent:
                              document.querySelector(
                                '.queued-message-editor textarea',
                              ) !== null,
                            messageActionCount: document.querySelectorAll(
                              '[data-artemis-component="conversation-message"] ' +
                                '[data-part="actions"] button',
                            ).length,
                          };
                        })()
                      : null,
                  feedbackLayout: (() => {
                    const selector = [
                      'tooltip',
                      'popover',
                      'dialog',
                      'confirmation',
                      'toast',
                      'inline-notice',
                      'empty-state',
                      'loading-state',
                      'error-state',
                      'toolbar',
                      'list-row',
                      'panel-header',
                      'scroll-area',
                      'split-pane',
                      'approval-card',
                      'result-disclosure',
                    ]
                      .map(
                        (component) =>
                          '[data-artemis-component="' + component + '"]',
                      )
                      .join(', ');
                    const roots = [...document.querySelectorAll(selector)];
                    const describe = (root) => {
                      const bounds = root.getBoundingClientRect();
                      const style = getComputedStyle(root);
                      const scrollContainer = root.closest('.timeline-scroll');
                      const scrollBounds = scrollContainer?.getBoundingClientRect();
                      const approvalActions =
                        root.getAttribute('data-artemis-component') ===
                        'approval-card'
                          ? root.querySelector('[data-part="actions"]')
                          : null;
                      const approvalActionBounds =
                        approvalActions?.getBoundingClientRect();
                      const approvalActionButtons = approvalActions
                        ? [...approvalActions.querySelectorAll('button')].map(
                            (button) => {
                              const buttonBounds =
                                button.getBoundingClientRect();
                              return {
                                width: buttonBounds.width,
                                height: buttonBounds.height,
                                clientWidth: button.clientWidth,
                                scrollWidth: button.scrollWidth,
                                clientHeight: button.clientHeight,
                                scrollHeight: button.scrollHeight,
                              };
                            },
                          )
                        : [];
                      const overlay = [
                        'tooltip',
                        'popover',
                        'dialog',
                        'toast',
                      ].includes(root.getAttribute('data-artemis-component'));
                      const inlineOverflow = [...root.querySelectorAll('*')]
                        .map((candidate) => {
                          const candidateBounds = candidate.getBoundingClientRect();
                          return {
                            tag: candidate.tagName.toLowerCase(),
                            className: candidate.getAttribute('class'),
                            component: candidate.getAttribute(
                              'data-artemis-component',
                            ),
                            part: candidate.getAttribute('data-part'),
                            clientWidth: candidate.clientWidth,
                            scrollWidth: candidate.scrollWidth,
                            left: candidateBounds.left,
                            right: candidateBounds.right,
                          };
                        })
                        .filter(
                          (candidate) =>
                            candidate.scrollWidth > candidate.clientWidth + 1 ||
                            candidate.left < bounds.left - 1 ||
                            candidate.right > bounds.right + 1,
                        )
                        .slice(0, 20);
                      return {
                        component: root.getAttribute(
                          'data-artemis-component',
                        ),
                        context: root.classList.contains('settings-panel')
                          ? 'settings'
                          : root.classList.contains(
                                'environment-checks-popover',
                              )
                            ? 'environment'
                            : root.classList.contains('approval-card')
                              ? 'approval'
                              : root.getAttribute(
                                  'data-artemis-component',
                                ) === 'approval-card'
                                ? 'approval'
                                : root.closest('.resource-page')
                                  ? 'resource'
                                  : root.classList.contains('transient-notice')
                                    ? 'app-notice'
                                    : 'other',
                        state: root.getAttribute('data-state'),
                        tone: root.getAttribute('data-tone'),
                        role: root.getAttribute('role'),
                        ariaLabel: root.getAttribute('aria-label'),
                        ariaLabelledBy: root.getAttribute('aria-labelledby'),
                        ariaDescribedBy: root.getAttribute('aria-describedby'),
                        ariaModal: root.getAttribute('aria-modal'),
                        geometry: {
                          left: bounds.left,
                          right: bounds.right,
                          top: bounds.top,
                          bottom: bounds.bottom,
                          width: bounds.width,
                          height: bounds.height,
                        },
                        withinViewport:
                          bounds.left >= -1 &&
                          bounds.right <= window.innerWidth + 1 &&
                          bounds.top >= -1 &&
                          bounds.bottom <= window.innerHeight + 1,
                        visibleWithinScrollContainer:
                          !scrollBounds ||
                          (bounds.left >= scrollBounds.left - 1 &&
                            bounds.right <= scrollBounds.right + 1 &&
                            bounds.top >= scrollBounds.top - 1 &&
                            bounds.bottom <= scrollBounds.bottom + 1),
                        scrollContainerGeometry: scrollBounds
                          ? {
                              left: scrollBounds.left,
                              right: scrollBounds.right,
                              top: scrollBounds.top,
                              bottom: scrollBounds.bottom,
                            }
                          : null,
                        scrollContainerMetrics:
                          scrollContainer instanceof HTMLElement
                            ? {
                                clientHeight: scrollContainer.clientHeight,
                                scrollHeight: scrollContainer.scrollHeight,
                                scrollTop: scrollContainer.scrollTop,
                              }
                            : null,
                        approvalActionsGeometry: approvalActionBounds
                          ? {
                              left: approvalActionBounds.left,
                              right: approvalActionBounds.right,
                              top: approvalActionBounds.top,
                              bottom: approvalActionBounds.bottom,
                            }
                          : null,
                        approvalActionsVisibleWithinScrollContainer:
                          !approvalActionBounds ||
                          !scrollBounds ||
                          (approvalActionBounds.left >= scrollBounds.left - 1 &&
                            approvalActionBounds.right <=
                              scrollBounds.right + 1 &&
                            approvalActionBounds.top >= scrollBounds.top - 1 &&
                            approvalActionBounds.bottom <=
                              scrollBounds.bottom + 1),
                        approvalActionButtons,
                        contentFitsInline:
                          root.scrollWidth <= root.clientWidth + 1,
                        inlineMetrics: {
                          clientWidth: root.clientWidth,
                          descendants: inlineOverflow,
                          scrollWidth: root.scrollWidth,
                        },
                        focusInside: root.contains(document.activeElement),
                        nativeDialogOpen:
                          root instanceof HTMLDialogElement ? root.open : null,
                        portalRoot: overlay
                          ? root.parentElement === document.body
                          : null,
                        parts: [
                          'root',
                          ...root.querySelectorAll('[data-part]'),
                        ].map((part) =>
                          typeof part === 'string'
                            ? part
                            : part.getAttribute('data-part'),
                        ),
                        computed: {
                          backgroundColor: style.backgroundColor,
                          borderStyle: style.borderStyle,
                          color: style.color,
                          direction: style.direction,
                          display: style.display,
                          overflowX: style.overflowX,
                          overflowY: style.overflowY,
                          position: style.position,
                          zIndex: style.zIndex,
                        },
                      };
                    };
                    const workspaceHeading = document.querySelector(
                      '.workspace-heading',
                    );
                    const workspaceLabel = workspaceHeading?.querySelector(
                      ':scope > strong',
                    );
                    const workspaceHeadingBounds =
                      workspaceHeading?.getBoundingClientRect();
                    const workspaceLabelBounds =
                      workspaceLabel?.getBoundingClientRect();
                    const workspaceLabelTextBounds = (() => {
                      if (!(workspaceLabel instanceof HTMLElement)) {
                        return null;
                      }
                      const range = document.createRange();
                      range.selectNodeContents(workspaceLabel);
                      return range.getBoundingClientRect();
                    })();
                    return {
                      components: roots.map(describe),
                      direction: document.documentElement.dir,
                      interaction:
                        window.__feedbackLayoutInteraction ?? null,
                      decisionApprovalVerification:
                        window.__decisionApprovalVerification ?? null,
                      workspaceLabel:
                        workspaceHeading instanceof HTMLElement &&
                        workspaceLabel instanceof HTMLElement &&
                        workspaceHeadingBounds &&
                        workspaceLabelBounds
                          ? {
                              contentFitsInline:
                                workspaceLabel.scrollWidth <=
                                workspaceLabel.clientWidth + 1,
                              fullyVisible:
                                workspaceLabelBounds.left >=
                                  workspaceHeadingBounds.left - 1 &&
                                workspaceLabelBounds.right <=
                                  workspaceHeadingBounds.right + 1,
                              text: workspaceLabel.textContent?.trim() ?? '',
                              textFullyVisible:
                                workspaceLabelTextBounds !== null &&
                                workspaceLabelTextBounds.left >=
                                  workspaceLabelBounds.left - 1 &&
                                workspaceLabelTextBounds.right <=
                                  workspaceLabelBounds.right + 1,
                            }
                          : null,
                      reducedMotion: window.matchMedia(
                        '(prefers-reduced-motion: reduce)',
                      ).matches,
                      rootTokens: {
                        overlayScrim: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-overlay-scrim')
                          .trim(),
                        shadowOverlay: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-shadow-overlay')
                          .trim(),
                        surfaceRaised: getComputedStyle(
                          document.documentElement,
                        )
                          .getPropertyValue('--artemis-color-surface-raised')
                          .trim(),
                      },
                    };
                  })(),
                  interactiveCount: document.querySelectorAll(
                    "button, a[href], summary, input, select, textarea, [role='button'], [role='tab']",
                  ).length,
                  runtimeGlobalSecurity: {
                    processType: typeof globalThis.process,
                    requireType: typeof globalThis.require,
                  },
                  issues,
                };
              })()
            `;
}

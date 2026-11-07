import { uiText } from "../../../../src/shared/i18n/ui-text.js";
import { currentLocale } from "../../../../src/main/main.js";
import { smokeMode } from "../../../../test/fixtures/smoke/environment.js";

// Kept as a renderer script: it executes inside the isolated page, never in Node.
export function prepareViewScript(
  requestedSmokeView: string | undefined,
  smokeWidth: number,
  smokeScale: number,
): string {
  return `
              (async () => {
                const wait = (milliseconds) =>
                  new Promise((resolve) => setTimeout(resolve, milliseconds));
                const openSmokeHistoryThread = async (threadId, readySelector = '.timeline .user-message') => {
                  const selector = '[data-tree-row-id="thread:' + threadId + '"] .thread-select';
                  const deadline = Date.now() + 30_000;
                  let selected = false;
                  while (Date.now() < deadline) {
                    if (!selected) {
                      const thread = document.querySelector(selector);
                      if (thread instanceof HTMLButtonElement) {
                        thread.click();
                        selected = true;
                      }
                    } else if (
                      !document.querySelector('.conversation-history-feedback') &&
                      document.querySelector(readySelector)
                    ) {
                      return;
                    }
                    await wait(50);
                  }
                  const feedback = document.querySelector('.conversation-history-feedback');
                  throw new Error('Smoke history did not load for ' + threadId +
                    ': selected=' + selected + '; feedback=' + (feedback?.textContent ?? 'none'));
                };
                const clickByText = (selector, text) => {
                  const button = [...document.querySelectorAll(selector)].find(
                    (candidate) =>
                      candidate.textContent?.trim().startsWith(text),
                  );
                  button?.click();
                };
                const view = ${JSON.stringify(requestedSmokeView)};
                const requestedDirection = ${JSON.stringify(
                  process.env.ARTEMIS_SMOKE_DIRECTION ?? "ltr",
                )};
                if (requestedDirection === 'rtl') {
                  document.documentElement.dir = 'rtl';
                }
                if (view.startsWith('nocturne-')) {
                  if (!${JSON.stringify(smokeMode)}) return;
                  if (view.startsWith('nocturne-settings-')) {
                    const settingsLabel = ${JSON.stringify(uiText(currentLocale(), "App_copy.settings"))};
                    const button = [...document.querySelectorAll('.activity-button, .rail-item')].find((candidate) => candidate.checkVisibility({ visibilityProperty: true }) && (candidate.getAttribute('aria-label') === settingsLabel || candidate.getAttribute('title') === settingsLabel));
                    button?.click();
                    await wait(700);
                    const section = view.slice('nocturne-settings-'.length);
                    document.querySelector('#settings-tab-' + section + '-button')?.click();
                    await wait(500);
                  } else if (view.startsWith('nocturne-resources-')) {
                    document.querySelector('.sidebar-nav [data-nav-view=resources]')?.click();
                    await wait(1_000);
                    const section = view.slice('nocturne-resources-'.length);
                    document.querySelector('#resource-management-tab-' + section)?.click();
                    await wait(700);
                  } else {
                    document.querySelector('[data-tree-row-id="thread:artemis-smoke-environment-thread"] .thread-select')?.click();
                    await wait(800);
                    if (view === 'nocturne-project-menu') document.querySelector('.project-action')?.click();
                    if (view === 'nocturne-thread-menu') document.querySelector('.thread-action')?.click();
                    if (view === 'nocturne-workspace-menu') {
                      if (!document.querySelector('.environment-panel')) document.querySelector('.environment-trigger')?.click();
                      await wait(200);
                      const trigger = document.querySelector('.environment-panel .environment-workspace-trigger');
                      if (!(trigger instanceof HTMLButtonElement)) throw new Error('Environment workspace trigger missing');
                      trigger.click();
                      await wait(200);
                      if (!document.querySelector('.environment-workspace-menu')) throw new Error('Workspace menu did not open');
                    }
                    if (view === 'nocturne-branch-menu') {
                      // The composer workspace row belongs to a new conversation.
                      // Existing conversations switch Git context in Environment.
                      document.querySelector('[data-tree-row-id="project:artemis-smoke-environment-project"] .project-new-thread')?.click();
                      const deadline = Date.now() + 10_000;
                      let trigger;
                      while (Date.now() < deadline) {
                        trigger = document.querySelector('.composer-context .branch-context-trigger');
                        if (trigger instanceof HTMLButtonElement && trigger.checkVisibility({ visibilityProperty: true })) break;
                        await wait(50);
                      }
                      if (!(trigger instanceof HTMLButtonElement) || !trigger.checkVisibility({ visibilityProperty: true })) throw new Error('Visible Composer branch trigger missing');
                      trigger.click();
                      while (Date.now() < deadline && !document.querySelector('.composer-context .branch-context-menu [role="menuitemradio"][aria-checked="true"]')) {
                        await wait(50);
                      }
                      if (trigger.getAttribute('aria-expanded') !== 'true' || !document.querySelector('.composer-context .branch-context-menu [role="menuitemradio"][aria-checked="true"]')) {
                        throw new Error('Composer branch menu did not load the current Git branch');
                      }
                    }
                    if (view === 'nocturne-terminal') {
                      const toggle = document.querySelector('.right-sidebar-toggle');
                      if (toggle?.getAttribute('aria-expanded') !== 'true') toggle?.click();
                      await wait(300);
                      const addButton = document.querySelector('.workspace-tab-add');
                      if (!(addButton instanceof HTMLButtonElement)) throw new Error('Dock add-tab trigger missing');
                      addButton.click();
                      const deadline = Date.now() + 20_000;
                      while (Date.now() < deadline && !document.querySelector('.terminal-panel[data-state="ready"] .xterm-screen')) {
                        const error = document.querySelector('.terminal-panel[data-state="error"]');
                        if (error) throw new Error('Native terminal failed: ' + error.textContent);
                        await wait(100);
                      }
                      if (!document.querySelector('.terminal-panel[data-state="ready"] .xterm-screen')) throw new Error('Native terminal did not become ready');
                    }
                    if (view.startsWith('nocturne-review-comment')) {
                      const environmentTrigger = document.querySelector('.environment-trigger');
                      if (!(environmentTrigger instanceof HTMLButtonElement)) throw new Error('Environment trigger missing for Review capture');
                      if (environmentTrigger.getAttribute('aria-expanded') !== 'true') environmentTrigger.click();
                      const label = ${JSON.stringify(uiText(currentLocale(), "App_copy.reviewChanges"))};
                      const deadline = Date.now() + 5_000;
                      let reviewAction;
                      while (Date.now() < deadline) {
                        reviewAction = [...document.querySelectorAll('.environment-popover button')].find((button) => button.textContent.trim() === label && button.checkVisibility({ visibilityProperty: true }));
                        if (reviewAction) break;
                        await wait(50);
                      }
                      if (!(reviewAction instanceof HTMLButtonElement)) throw new Error('Visible Review action missing from Environment');
                      reviewAction.click();
                      await wait(800);
                      document.querySelector('.review-comment-trigger')?.click();
                      await wait(200);
                      const input = document.querySelector('.review-comment-editor textarea');
                      if (!(input instanceof HTMLTextAreaElement)) throw new Error('Review inline comment editor missing');
                      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, 'Please explain this change.');
                      input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    await wait(400);
                  }
                  return;
                }
                if (view === 'feedback-layout-settings') {
                  // Compact layouts close the sidebar after the zoom resize;
                  // wide layouts intentionally keep a manually closed sidebar closed.
                  if (${smokeWidth / smokeScale <= 1060}) {
                    for (let attempt = 0; attempt < 100; attempt += 1) {
                      if (window.innerWidth <= 1060 && document.querySelector('.app-shell')?.getAttribute('data-sidebar-open') === 'false') break;
                      await wait(50);
                    }
                    if (window.innerWidth > 1060 || document.querySelector('.app-shell')?.getAttribute('data-sidebar-open') !== 'false') {
                      throw new Error('Compact settings sidebar did not settle after zoom.');
                    }
                  }
                  const activity = [...document.querySelectorAll('.activity-button, .rail-item')].find(
                    (candidate) =>
                      candidate.checkVisibility({ visibilityProperty: true }) &&
                      !candidate.closest('[inert], [aria-hidden="true"]') &&
                      (candidate.getAttribute('aria-label') === ${JSON.stringify(uiText(currentLocale(), "App_copy.settings"))} ||
                      candidate.getAttribute('title') === ${JSON.stringify(uiText(currentLocale(), "App_copy.settings"))}),
                  );
                  if (!(activity instanceof HTMLButtonElement)) {
                    throw new Error('Settings activity button missing.');
                  }
                  activity.click();
                  await wait(700);
                  let dialog = document.querySelector(
                    '.settings-panel[data-artemis-component="dialog"]',
                  );
                  if (!(dialog instanceof HTMLDialogElement)) {
                    throw new Error('Public Settings Dialog missing.');
                  }
                  const firstOpenFocusInside = dialog.contains(
                    document.activeElement,
                  );
                  dialog.dispatchEvent(
                    new Event('cancel', { bubbles: false, cancelable: true }),
                  );
                  await wait(250);
                  const focusReturned = document.activeElement === activity;
                  const focusAfterClose = document.activeElement?.outerHTML?.slice(0, 500);
                  activity.click();
                  await wait(700);
                  dialog = document.querySelector(
                    '.settings-panel[data-artemis-component="dialog"]',
                  );
                  window.__feedbackLayoutInteraction = {
                    view,
                    firstOpenFocusInside,
                    focusReturned,
                    focusAfterClose,
                    trigger: activity.outerHTML.slice(0, 500),
                    reopened: dialog instanceof HTMLDialogElement,
                    nativeModal: dialog instanceof HTMLDialogElement && dialog.open,
                  };
                  return;
                }
                if (view === 'user-input-transport') {
                  document.querySelector('.thread-select')?.click();
                  await wait(800);
                  return;
                }
                if (view.startsWith('conversation-timeline-')) {
                  await openSmokeHistoryThread(
                    'artemis-smoke-conversation-thread',
                    view.startsWith('conversation-timeline-empty')
                      ? '[data-artemis-component="conversation-empty-state"]'
                      : '.timeline .user-message',
                  );
                  const viewport = document.querySelector(
                    '[data-artemis-component="timeline-viewport"]',
                  );
                  if (
                    view === 'conversation-timeline-rich' &&
                    viewport instanceof HTMLElement
                  ) {
                    // Mark a user scroll so bottom-following does not undo it.
                    viewport.dispatchEvent(new WheelEvent('wheel', {
                      bubbles: true,
                      deltaY: -viewport.scrollHeight,
                    }));
                    viewport.scrollTop = 0;
                    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
                    const disclosureDeadline = performance.now() + 1_000;
                    while (
                      !document.querySelector(
                        '[data-artemis-component="turn-execution-disclosure"]',
                      ) && performance.now() < disclosureDeadline
                    ) {
                      await wait(25);
                    }
                  }
                  const disclosure = document.querySelector(
                    '[data-artemis-component="turn-execution-disclosure"]',
                  );
                  let bottomDistanceBefore = null;
                  let bottomDistanceAfter = null;
                  if (
                    view === 'conversation-timeline-rich' &&
                    viewport instanceof HTMLElement &&
                    disclosure instanceof HTMLDetailsElement
                  ) {
                    viewport.scrollTop = viewport.scrollHeight;
                    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
                    bottomDistanceBefore =
                      viewport.scrollHeight -
                      viewport.clientHeight -
                      viewport.scrollTop;
                    disclosure.querySelector('summary')?.click();
                    await wait(180);
                    bottomDistanceAfter =
                      viewport.scrollHeight -
                      viewport.clientHeight -
                      viewport.scrollTop;
                  }
                  const assistantAction = document.querySelector(
                    '[data-artemis-component="conversation-message"]' +
                      '[data-message-kind="assistant"] [data-part="actions"] button',
                  );
                  const assistantActions = assistantAction?.closest(
                    '[data-part="actions"]',
                  );
                  let actionOpacity = null;
                  if (assistantAction instanceof HTMLButtonElement) {
                    const previousFocus = document.activeElement;
                    assistantAction.focus({ preventScroll: true });
                    const actionOpacityDeadline = performance.now() + 1_000;
                    do {
                      actionOpacity = assistantActions
                        ? getComputedStyle(assistantActions).opacity
                        : null;
                      if (Number(actionOpacity) >= 0.99) break;
                      await wait(25);
                    } while (performance.now() < actionOpacityDeadline);
                    // The keyboard evidence must not leave a synthetic focus ring
                    // on a message action in the final visual fixture.
                    assistantAction.blur();
                    if (previousFocus instanceof HTMLElement && previousFocus !== document.body) {
                      previousFocus.focus({ preventScroll: true, focusVisible: false });
                    }
                  }
                  const agentButtons = [
                    ...document.querySelectorAll(
                      'button[data-artemis-component="agent-activity"]',
                    ),
                  ];
                  const activeAgent = agentButtons.find((candidate) =>
                    candidate.textContent?.includes('Independent review'),
                  );
                  let childPanelOpened = false;
                  if (activeAgent instanceof HTMLButtonElement) {
                    activeAgent.click();
                    await wait(180);
                    childPanelOpened =
                      document.querySelector('.child-agent-panel') !== null;
                    document
                      .querySelector(
                        '[data-artemis-component="workspace-tab"] > [data-part="close"]',
                      )
                      ?.click();
                    await wait(120);
                  }
                  const inputChoice = document.querySelector(
                    '[data-artemis-component="user-input"] ' +
                      '[role="option"], ' +
                      '[data-artemis-component="user-input"] button',
                  );
                  if (inputChoice instanceof HTMLElement) {
                    inputChoice.focus({ preventScroll: true });
                  }
                  if (viewport instanceof HTMLElement) {
                    viewport.scrollTop = viewport.scrollHeight;
                  }
                  window.__conversationTimelineInteraction = {
                    view,
                    disclosureOpened:
                      disclosure instanceof HTMLDetailsElement && disclosure.open,
                    bottomDistanceBefore,
                    bottomDistanceAfter,
                    actionOpacity,
                    childPanelOpened,
                    inputFocused:
                      inputChoice instanceof HTMLElement &&
                      document.activeElement === inputChoice,
                  };
                  return;
                }
                if (view.startsWith('icon-sizing-')) {
                  if (view.startsWith('icon-sizing-environment')) {
                    document.querySelector('.thread-select')?.click();
                    await wait(600);
                    const trigger = document.querySelector(
                      '.environment-trigger',
                    );
                    if (trigger?.getAttribute('aria-expanded') !== 'true') {
                      trigger?.click();
                      await wait(500);
                    }
                    if (view === 'icon-sizing-environment') {
                      document.querySelector('.environment-pr-check-summary')?.click();
                      await wait(300);
                    }
                    if (view === 'icon-sizing-environment-branch-menu') {
                      document
                        .querySelector(
                          '.environment-branch-control > .environment-row',
                        )
                        ?.click();
                      await wait(500);
                    }
                    if (view === 'icon-sizing-environment-commit') {
                      document.querySelector('.commit-push-row')?.click();
                      await wait(500);
                    }
                    return;
                  }
                  document.querySelector('.sidebar-nav [data-nav-view=resources]')?.click();
                  await wait(1_000);
                  if (view === 'icon-sizing-add-plugin') {
                    document.querySelector('.resource-add-button')?.click();
                    await wait(500);
                  } else if (view === 'icon-sizing-resource-manage') {
                    document.querySelector('#resource-management-tab-mcp')?.click();
                    await wait(300);
                    // Open the official MCP discovery panel: its form search
                    // icon rides the same styles rule group as the manage
                    // toolbar search icon but sits in block flow, so the
                    // measurement is not skewed by toolbar flex shrink.
                    document
                      .querySelector(
                        '.resource-list-heading-actions .resource-add-button',
                      )
                      ?.click();
                    await wait(300);
                  }
                  return;
                }
                if (view.startsWith('goal-')) {
                  await openSmokeHistoryThread('artemis-smoke-goal-thread', '.goal-bar-main');
                  document.querySelector('.confirmation-actions .secondary-button')?.click();
                  if (view.startsWith('goal-editor')) {
                    const waitForGoalElement = async (selector) => {
                      const deadline = Date.now() + 8000;
                      while (Date.now() < deadline) {
                        const element = document.querySelector(selector);
                        if (element) return element;
                        await wait(100);
                      }
                      throw new Error('Goal editor element did not become ready: ' + selector);
                    };
                    const trigger = await waitForGoalElement('.goal-bar-main');
                    trigger.click();
                    if (view === 'goal-editor-load-error') {
                      await waitForGoalElement('.goal-editor-stale[role="alert"]');
                      return;
                    }
                    const input = await waitForGoalElement('.goal-editor-input');
                    if (!(input instanceof HTMLTextAreaElement)) {
                      throw new Error('Goal editor did not open.');
                    }
                    if (view === 'goal-editor-clean') return;
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLTextAreaElement.prototype,
                      'value',
                    )?.set;
                    const editedValue = view === 'goal-editor-empty'
                      ? '   '
                      : '编辑后的 Goal 内容已通过独立编辑器保存';
                    setter?.call(input, editedValue);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    await wait(250);
                    if (view === 'goal-editor-dirty' || view === 'goal-editor-empty') {
                      return;
                    }
                    if (view === 'goal-editor-revert') {
                      document.querySelector('.goal-editor-revert')?.click();
                      await wait(250);
                      return;
                    }
                    if (view === 'goal-editor-shortcut') {
                      input.dispatchEvent(new KeyboardEvent('keydown', {
                        bubbles: true,
                        key: 'Enter',
                        metaKey: true,
                      }));
                      await wait(800);
                      return;
                    }
                    document
                      .querySelector('.goal-editor-footer .primary-button')
                      ?.click();
                    await wait(view === 'goal-editor-saving' ? 200 : 800);
                  }
                  return;
                }
                if (view.startsWith('secondary-pages-')) {
                  const waitForElement = async (selector) => {
                    const deadline = Date.now() + 8000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  const routes = {
                    'secondary-pages-token-usage': {
                      navigationView: 'token-usage',
                      selector: '.token-usage-page',
                    },
                    'secondary-pages-automations': {
                      navigationView: 'automations',
                      selector: '.automation-page',
                    },
                    'secondary-pages-archive': {
                      navigationView: 'archive',
                      selector: '.archive-page',
                    },
                  };
                  const route = routes[view];
                  const activity = route
                    ? document.querySelector('.sidebar-nav [data-nav-view=' + route.navigationView + ']')
                    : null;
                  if (!(activity instanceof HTMLButtonElement) || !route) {
                    throw new Error('Unknown secondary-pages smoke view: ' + view);
                  }
                  activity.click();
                  const page = await waitForElement(route.selector);
                  if (!page) {
                    throw new Error(
                      'Secondary page did not render for smoke view: ' + view,
                    );
                  }
                  if (view === 'secondary-pages-token-usage') {
                    page.scrollTop = page.scrollHeight;
                    const grid = await waitForElement(
                      '[data-artemis-component="data-heatmap"] [data-part="grid"]',
                    );
                    const scrollPort = grid?.closest(
                      '.token-usage-chart-scroll',
                    );
                    if (scrollPort) {
                      const pageBounds = page.getBoundingClientRect();
                      const portBounds = scrollPort.getBoundingClientRect();
                      if (
                        portBounds.top < pageBounds.top ||
                        portBounds.bottom > pageBounds.bottom
                      ) {
                        page.scrollTop += portBounds.top - pageBounds.top - 16;
                        await wait(50);
                      }
                    }
                    const cells = [
                      ...(grid?.querySelectorAll('[role="gridcell"]') ?? []),
                    ];
                    const finalColumn = Math.max(
                      ...cells.map((cell) =>
                        Number(cell.getAttribute('aria-colindex') ?? 0),
                      ),
                    );
                    const target = cells.find(
                      (cell) =>
                        Number(cell.getAttribute('aria-colindex')) ===
                        finalColumn,
                    );
                    const targetRow = target?.closest('[role="row"]');
                    const source = targetRow?.querySelector(
                      '[role="gridcell"][aria-colindex="' +
                        String(finalColumn - 1) +
                        '"]',
                    );
                    if (
                      source instanceof HTMLButtonElement &&
                      target instanceof HTMLButtonElement
                    ) {
                      source.focus({ preventScroll: true });
                      source.dispatchEvent(
                        new KeyboardEvent('keydown', {
                          bubbles: true,
                          key:
                            getComputedStyle(grid).direction === 'rtl'
                              ? 'ArrowLeft'
                              : 'ArrowRight',
                        }),
                      );
                      await wait(100);
                      if (document.activeElement !== target) {
                        throw new Error(
                          'Heatmap keyboard navigation did not reach the final column.',
                        );
                      }
                    }
                  }
                  await wait(300);
                  return;
                }
                if (view.startsWith('input-fields-')) {
                  const waitForElement = async (selector) => {
                    const deadline = Date.now() + 8000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  const clickActivity = (label) => {
                    const localizedLabels = ${JSON.stringify({
                      Settings: uiText(currentLocale(), "App_copy.settings"),
                      Automations: uiText(
                        currentLocale(),
                        "App_copy.automations",
                      ),
                      Archive: uiText(
                        currentLocale(),
                        "App.archiveConversations",
                      ),
                    })};
                    const expectedLabel = localizedLabels[label] ?? label;
                    const button = [
                      ...document.querySelectorAll('.activity-button, .rail-item, .sidebar-nav [data-nav-view]'),
                    ].find(
                      (candidate) => candidate.checkVisibility({ visibilityProperty: true }) &&
                        !candidate.closest('[inert], [aria-hidden="true"]') &&
                        (candidate.getAttribute('aria-label') === expectedLabel ||
                        candidate.getAttribute('title') === expectedLabel),
                    );
                    button?.click();
                    return Boolean(button);
                  };
                  if (view === 'input-fields-automations-once') {
                    if (!clickActivity('Automations')) {
                      throw new Error('Automations activity button missing.');
                    }
                    if (!(await waitForElement('.automation-page'))) {
                      throw new Error('Automation page did not render.');
                    }
                    const createButton = await waitForElement(
                      '.automation-create-button:not(:disabled)',
                    );
                    if (!createButton) {
                      throw new Error(
                        'Automation create button stayed disabled.',
                      );
                    }
                    createButton.click();
                    if (!(await waitForElement('.automation-dialog'))) {
                      throw new Error('Automation dialog did not open.');
                    }
                    const presetSelect = [
                      ...document.querySelectorAll(
                        '.automation-dialog [data-artemis-component="select"]',
                      ),
                    ].find((select) =>
                      select.querySelector('[data-part="label"]')
                        ?.textContent?.trim() === 'Schedule',
                    );
                    const presetTrigger = presetSelect?.querySelector(
                      '[data-part="trigger"]',
                    );
                    if (!(presetTrigger instanceof HTMLButtonElement)) {
                      throw new Error('Schedule preset select missing.');
                    }
                    presetTrigger.click();
                    await waitForElement(
                      '.automation-dialog [role="option"]',
                    );
                    const onceOption = [
                      ...document.querySelectorAll(
                        '.automation-dialog [role="option"]',
                      ),
                    ].find(
                      (option) =>
                        option.querySelector('span:last-child')
                          ?.textContent?.trim() === 'Once',
                    );
                    if (!(onceOption instanceof HTMLElement)) {
                      throw new Error('Once schedule option missing.');
                    }
                    onceOption.click();
                    if (
                      !(await waitForElement(
                        '.automation-dialog input[type="date"]',
                      ))
                    ) {
                      throw new Error('Once date field did not render.');
                    }
                    return;
                  }
                  if (view === 'input-fields-settings-avatar') {
                    if (!clickActivity('Settings')) {
                      throw new Error('Settings activity button missing.');
                    }
                    if (!(await waitForElement('.settings-panel'))) {
                      throw new Error('Settings panel did not render.');
                    }
                    if (
                      !(await waitForElement('.profile-avatar-input')) ||
                      !(await waitForElement(
                        '.settings-profile-avatar-actions [data-artemis-component="button"]',
                      ))
                    ) {
                      throw new Error('Avatar field did not render.');
                    }
                    return;
                  }
                  return;
                }
                if (view.startsWith('form-controls-')) {
                  const waitForElement = async (selector) => {
                    const deadline = Date.now() + 8000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  const clickActivity = (label) => {
                    const localizedLabels = ${JSON.stringify({
                      Settings: uiText(currentLocale(), "App_copy.settings"),
                      Automations: uiText(
                        currentLocale(),
                        "App_copy.automations",
                      ),
                      Archive: uiText(
                        currentLocale(),
                        "App.archiveConversations",
                      ),
                    })};
                    const expectedLabel = localizedLabels[label] ?? label;
                    const button = [
                      ...document.querySelectorAll('.activity-button, .rail-item, .sidebar-nav [data-nav-view]'),
                    ].find(
                      (candidate) => candidate.checkVisibility({ visibilityProperty: true }) &&
                        !candidate.closest('[inert], [aria-hidden="true"]') &&
                        (candidate.getAttribute('aria-label') === expectedLabel ||
                        candidate.getAttribute('title') === expectedLabel),
                    );
                    button?.click();
                    return Boolean(button);
                  };
                  if (view === 'form-controls-archive') {
                    if (!clickActivity('Archive')) {
                      throw new Error('Archive activity button missing.');
                    }
                    const searchRoot = await waitForElement(
                      '[data-artemis-component="search-field"].archive-search',
                    );
                    const search = searchRoot?.querySelector(
                      '[data-part="control"]',
                    );
                    if (!(search instanceof HTMLInputElement)) {
                      throw new Error('Public archive SearchField missing.');
                    }
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLInputElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(search, 'synthetic archive query');
                    search.dispatchEvent(new Event('input', { bubbles: true }));
                    await wait(200);
                    search.focus({ preventScroll: true, focusVisible: true });
                    window.__formControlsInteraction = {
                      view,
                      searchValue: search.value,
                      rootStable:
                        searchRoot ===
                        document.querySelector(
                          '[data-artemis-component="search-field"].archive-search',
                        ),
                    };
                    return;
                  }
                  if (view.startsWith('form-controls-settings')) {
                    if (!clickActivity('Settings')) {
                      throw new Error('Settings activity button missing.');
                    }
                    if (!(await waitForElement('.settings-panel'))) {
                      throw new Error('Settings panel did not render.');
                    }
                    const providersTab = await waitForElement(
                      '#settings-tab-providers-button',
                    );
                    if (!(providersTab instanceof HTMLButtonElement)) {
                      throw new Error('Settings providers tab missing.');
                    }
                    providersTab.click();
                    if (view === 'form-controls-settings-custom') {
                      const addService = await waitForElement(
                        '.provider-add-service',
                      );
                      if (!(addService instanceof HTMLButtonElement)) {
                        throw new Error('Settings add service button missing.');
                      }
                      addService.click();
                      const catalog = await waitForElement(
                        '.provider-catalog-dialog',
                      );
                      const customService = [
                        ...(catalog?.querySelectorAll('button') ?? []),
                      ].find((button) => button.textContent?.trim() === ${JSON.stringify(uiText(currentLocale(), "Review03.customService"))});
                      if (!(customService instanceof HTMLButtonElement)) {
                        throw new Error('Settings custom service picker action missing.');
                      }
                      customService.click();
                      const capabilities = await waitForElement(
                        '.provider-form-disclosure > summary',
                      );
                      capabilities?.click();
                      const checkboxRoot = await waitForElement(
                        '.provider-form [data-artemis-component="checkbox"]',
                      );
                      const checkbox = checkboxRoot?.querySelector(
                        '[data-part="control"]',
                      );
                      if (!(checkbox instanceof HTMLInputElement)) {
                        throw new Error('Public Settings Checkbox missing.');
                      }
                      const beforeChecked = checkbox.checked;
                      checkbox.click();
                      await wait(200);
                      window.__formControlsInteraction = {
                        view,
                        beforeChecked,
                        afterChecked: checkbox.checked,
                        checkboxRootStable:
                          checkboxRoot ===
                          document.querySelector(
                            '.provider-form [data-artemis-component="checkbox"]',
                          ),
                      };
                      return;
                    }
                    const addModel = await waitForElement(
                      '.provider-models > [data-part="header"] [data-part="actions"] button',
                    );
                    if (!(addModel instanceof HTMLButtonElement)) {
                      throw new Error('Settings add model button missing.');
                    }
                    addModel.click();
                    const catalogModel = await waitForElement(
                      '.provider-add-model-menu [role="menuitem"]',
                    );
                    if (!(catalogModel instanceof HTMLButtonElement)) {
                      throw new Error('Settings catalog model menu item missing.');
                    }
                    catalogModel.click();
                    const field = await waitForElement(
                      '.provider-add-model [data-artemis-component="text-field"] input[type="number"]',
                    );
                    const trigger = await waitForElement(
                      '.provider-add-model [data-artemis-component="select"] [data-part="trigger"]:not(:disabled)',
                    );
                    const selectRoot = trigger?.closest(
                      '[data-artemis-component="select"]',
                    );
                    if (
                      !(field instanceof HTMLInputElement) ||
                      !(trigger instanceof HTMLButtonElement)
                    ) {
                      throw new Error('Public Settings field/select missing.');
                    }
                    trigger.scrollIntoView({ block: 'center' });
                    await wait(200);
                    const beforeText = trigger.textContent?.trim() ?? '';
                    trigger.click();
                    const search = await waitForElement(
                      '.provider-add-model [data-artemis-component="select"] [data-part="search"]',
                    );
                    if (!(search instanceof HTMLInputElement)) {
                      throw new Error('Public searchable Select did not open.');
                    }
                    await wait(200);
                    const openMenu = selectRoot.querySelector(
                      '[data-part="menu"]',
                    );
                    const openListbox = selectRoot.querySelector(
                      '[data-part="listbox"]',
                    );
                    const rootBounds = selectRoot.getBoundingClientRect();
                    const openMenuBounds = openMenu?.getBoundingClientRect();
                    const openMenuStyle = openMenu
                      ? getComputedStyle(openMenu)
                      : null;
                    const openListboxStyle = openListbox
                      ? getComputedStyle(openListbox)
                      : null;
                    const openedMenu =
                      openMenuBounds && openMenuStyle
                        ? {
                            backgroundColor: openMenuStyle.backgroundColor,
                            borderStyle: openMenuStyle.borderStyle,
                            borderWidth: openMenuStyle.borderWidth,
                            geometry: {
                              width: openMenuBounds.width,
                              height: openMenuBounds.height,
                            },
                            inlineStartDelta: Math.abs(
                              openMenuBounds.left - rootBounds.left,
                            ),
                            inlineEndDelta: Math.abs(
                              openMenuBounds.right - rootBounds.right,
                            ),
                            listboxOverflowY:
                              openListboxStyle?.overflowY ?? null,
                            overflowX: openMenuStyle.overflowX,
                            overflowY: openMenuStyle.overflowY,
                            withinViewport:
                              openMenuBounds.left >= 0 &&
                              openMenuBounds.right <= window.innerWidth &&
                              openMenuBounds.top >= 0 &&
                              openMenuBounds.bottom <= window.innerHeight,
                            zIndex: openMenuStyle.zIndex,
                          }
                        : null;
                    const optionCount = selectRoot.querySelectorAll(
                      '[role="option"]',
                    ).length;
                    search.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        bubbles: true,
                        key: 'ArrowDown',
                      }),
                    );
                    await wait(100);
                    search.dispatchEvent(
                      new CompositionEvent('compositionstart', {
                        bubbles: true,
                        data: '中',
                      }),
                    );
                    search.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        bubbles: true,
                        isComposing: true,
                        key: 'Enter',
                      }),
                    );
                    await wait(100);
                    const composedMenuOpen =
                      selectRoot?.querySelector('[data-part="listbox"]') !==
                      null;
                    const composedText = trigger.textContent?.trim() ?? '';
                    search.dispatchEvent(
                      new CompositionEvent('compositionend', {
                        bubbles: true,
                        data: '中',
                      }),
                    );
                    search.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        bubbles: true,
                        key: 'Enter',
                      }),
                    );
                    await wait(250);
                    field.focus({ preventScroll: true, focusVisible: true });
                    window.__formControlsInteraction = {
                      view,
                      beforeText,
                      optionCount,
                      composedText,
                      composedMenuOpen,
                      openedMenu,
                      committedMenuClosed:
                        selectRoot?.querySelector('[data-part="listbox"]') ===
                        null,
                      committedText: trigger.textContent?.trim() ?? '',
                      selectRootStable:
                        selectRoot ===
                        document.querySelector(
                          '.provider-add-model [data-artemis-component="select"]',
                        ),
                    };
                    return;
                  }
                  if (view === 'form-controls-composer') {
                    document.querySelector('.thread-select')?.click();
                    await waitForElement('.composer-run-modes [role="radio"]:not(:disabled)');
                    return;
                  }
                  throw new Error('Unknown form-controls smoke view: ' + view);
                }
                if (view.startsWith('queued-steer')) {
                  const waitFor = async (selector) => {
                    const deadline = Date.now() + 5000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  document.querySelector('.thread-select')?.click();
                  await waitFor('.queued-message-bar');
                  if (!document.querySelector('.queued-message-bar')) {
                    throw new Error('Queued message bar did not render.');
                  }
                  const captureActionsGeometry = () => {
                    const container = document.querySelector(
                      '.queued-message-editor-actions',
                    );
                    if (!container) {
                      window.__queuedSteerActions = null;
                      return;
                    }
                    const buttons = Array.from(
                      container.querySelectorAll('button'),
                    );
                    const style = getComputedStyle(container);
                    const bounds = container.getBoundingClientRect();
                    window.__queuedSteerActions = {
                      present: true,
                      directChildOfEditorRoot:
                        container.parentElement ===
                        container.closest('.queued-message-editor'),
                      display: style.display,
                      flexDirection: style.flexDirection,
                      justifyContent: style.justifyContent,
                      gap: style.gap,
                      buttonCount: buttons.length,
                      buttonLabels: buttons.map((button) =>
                        (button.textContent ?? '').trim(),
                      ),
                      containerWidth: bounds.width,
                      buttonWidths: buttons.map(
                        (button) => button.getBoundingClientRect().width,
                      ),
                      buttonTops: buttons.map(
                        (button) => button.getBoundingClientRect().top,
                      ),
                    };
                  };
                  const openEditor = async () => {
                    document
                      .querySelector('[data-queued-index="0"] .queued-message-edit')
                      ?.click();
                    await wait(350);
                    const editor = document.querySelector(
                      '.queued-message-editor textarea',
                    );
                    if (!(editor instanceof HTMLTextAreaElement)) {
                      throw new Error('Queued message editor did not open.');
                    }
                    captureActionsGeometry();
                    return editor;
                  };
                  const setEditorValue = async (editor, value) => {
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLTextAreaElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(editor, value);
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                    await wait(250);
                  };
                  if (view === 'queued-steer-edit') {
                    await openEditor();
                    return;
                  }
                  if (view === 'queued-steer-cancel') {
                    const editor = await openEditor();
                    editor.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        key: 'Escape',
                        bubbles: true,
                      }),
                    );
                    await wait(350);
                    return;
                  }
                  if (
                    view === 'queued-steer-save' ||
                    view === 'queued-steer-save-error'
                  ) {
                    const editor = await openEditor();
                    await setEditorValue(
                      editor,
                      '排队消息一（已编辑）：格式检查通过，继续类型检查',
                    );
                    editor.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        key: 'Enter',
                        metaKey: true,
                        bubbles: true,
                      }),
                    );
                    await wait(800);
                    return;
                  }
                  if (view === 'queued-steer-ime') {
                    const editor = await openEditor();
                    await setEditorValue(
                      editor,
                      '排队消息一（输入法组合中）：正在输入中文',
                    );
                    editor.dispatchEvent(
                      new CompositionEvent('compositionstart', {
                        bubbles: true,
                      }),
                    );
                    const composingEnter = new KeyboardEvent('keydown', {
                      key: 'Enter',
                      metaKey: true,
                      bubbles: true,
                      isComposing: true,
                    });
                    window.__queuedSteerProbe = {
                      compositionstartDispatched: true,
                      dispatchedIsComposing: composingEnter.isComposing,
                      submitBlocked: false,
                    };
                    editor.dispatchEvent(composingEnter);
                    await wait(500);
                    window.__queuedSteerProbe.submitBlocked =
                      document.querySelector(
                        '.queued-message-editor textarea',
                      ) !== null;
                    return;
                  }
                  return;
                }
                if (view.startsWith('markdown-editor')) {
                  const waitFor = async (selector) => {
                    const deadline = Date.now() + 5000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  if (view === 'markdown-editor-navigation-preview') {
                    await openSmokeHistoryThread('artemis-smoke-markdown-editor-thread');
                    const completedTurn = await waitFor('.turn-execution-details');
                    if (completedTurn instanceof HTMLDetailsElement && !completedTurn.open) {
                      completedTurn.querySelector(':scope > summary')?.click();
                    }
                    const disclosure = await waitFor(
                      '.tool-card[data-artemis-component="tool-activity"] [data-part="disclosure"]',
                    );
                    if (!(disclosure instanceof HTMLButtonElement)) {
                      throw new Error('Synthetic Markdown tool activity missing.');
                    }
                    disclosure.click();
                    const fileLink = await waitFor('.tool-file-link');
                    if (!(fileLink instanceof HTMLButtonElement)) {
                      throw new Error('Synthetic Markdown file link missing.');
                    }
                    fileLink.click();
                    if (
                      !(await waitFor(
                        '[data-artemis-component="workspace-tab-pane"][data-state="active"] > [data-artemis-component="workspace-editor-toolbar"]',
                      ))
                    ) {
                      throw new Error('Markdown reader panel did not render.');
                    }
                    return;
                  }
                  document.querySelector('.thread-select')?.click();
                  await wait(400);
                  document.querySelector('.right-sidebar-toggle')?.click();
                  await waitFor('.workspace-tab-add');
                  document.querySelector('.workspace-tab-add')?.click();
                  // The host driver selects Files in the real native child
                  // window; the menu is no longer in this renderer's DOM.
                  await waitFor(
                    '[data-artemis-component="workspace-file-tree"]',
                  );
                  const treeRowFor = (fileName) =>
                    waitFor(
                      '[data-artemis-component="workspace-file-tree-row"][title="' + fileName + '"]',
                    );
                  if (view === 'markdown-editor-binary') {
                    const binaryRow = await treeRowFor('fixture.bin');
                    if (!binaryRow) {
                      throw new Error('Seeded binary file did not render.');
                    }
                    binaryRow.click();
                    await waitFor(
                      '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-content-state"]',
                    );
                    return;
                  }
                  if (view === 'markdown-editor-large-file') {
                    const largeRow = await treeRowFor('LARGE.ts');
                    if (!largeRow) {
                      throw new Error('Seeded large source file did not render.');
                    }
                    largeRow.click();
                    await waitFor(
                      '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"]',
                    );
                    await waitFor(
                      '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-source-editor"] [data-part="source"]',
                    );
                    return;
                  }
                  const markdownRow = await treeRowFor('NOTES.md');
                  if (!markdownRow) {
                    throw new Error('Seeded markdown file did not render.');
                  }
                  markdownRow.click();
                  await waitFor(
                    '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"]',
                  );
                  await waitFor('[data-workspace-image-failed]');
                  if (view === 'markdown-editor-navigation-toolbar') {
                    return;
                  }
                  const openSourceView = async () => {
                    const sourceButton = [
                      ...document.querySelectorAll(
                        '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] button',
                      ),
                    ].find(
                      (button) =>
                        (button.textContent ?? '').trim() === 'Source',
                    );
                    sourceButton?.click();
                    await wait(300);
                    return document.querySelector(
                      '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-source-editor"] [data-part="source"]',
                    );
                  };
                  const setSourceValue = async (textarea, value) => {
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLTextAreaElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(textarea, value);
                    textarea.dispatchEvent(
                      new Event('input', { bubbles: true }),
                    );
                    await wait(250);
                  };
                  if (view === 'markdown-editor-open') {
                    return;
                  }
                  if (view === 'markdown-editor-image-failure') {
                    document
                      .querySelector('[data-workspace-image-failed]')
                      ?.scrollIntoView({ block: 'center' });
                    await wait(300);
                    return;
                  }
                  if (view === 'markdown-editor-toggle') {
                    const toggleStates = () => {
                      const buttons = [
                        ...document.querySelectorAll(
                          '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] button',
                        ),
                      ];
                      return {
                        richPressed:
                          buttons[0]?.getAttribute('aria-pressed') ?? null,
                        sourcePressed:
                          buttons[1]?.getAttribute('aria-pressed') ?? null,
                        textareaPresent:
                          document.querySelector(
                            '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-source-editor"] [data-part="source"]',
                          ) !== null,
                        previewPresent:
                          document.querySelector(
                            '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-preview"]',
                          ) !== null,
                      };
                    };
                    const sourceButton = [
                      ...document.querySelectorAll(
                        '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] button',
                      ),
                    ].find(
                      (button) =>
                        (button.textContent ?? '').trim() === 'Source',
                    );
                    sourceButton?.click();
                    await wait(300);
                    const afterSource = toggleStates();
                    const richButton = [
                      ...document.querySelectorAll(
                        '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] button',
                      ),
                    ].find(
                      (button) =>
                        (button.textContent ?? '').trim() === 'Rich text',
                    );
                    richButton?.click();
                    await waitFor(
                      '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-preview"]',
                    );
                    await waitFor('[data-workspace-image-failed]');
                    const afterRich = toggleStates();
                    sourceButton?.click();
                    await wait(300);
                    window.__markdownEditorToggleProbe = {
                      afterSource,
                      afterRich,
                    };
                    return;
                  }
                  const textarea = await openSourceView();
                  if (!(textarea instanceof HTMLTextAreaElement)) {
                    throw new Error('Source editing surface did not open.');
                  }
                  await setSourceValue(
                    textarea,
                    textarea.value +
                      '\\n\\nEdited line appended by the markdown editor smoke run.',
                  );
                  if (view === 'markdown-editor-dirty') {
                    return;
                  }
                  textarea.focus();
                  const statusRegion = document.querySelector(
                    '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="status"]',
                  );
                  window.__markdownEditorStatusTrace = [];
                  if (statusRegion) {
                    new MutationObserver(() => {
                      const text = statusRegion.textContent?.trim() ?? '';
                      const trace = window.__markdownEditorStatusTrace;
                      if (trace[trace.length - 1] !== text) trace.push(text);
                    }).observe(statusRegion, {
                      childList: true,
                      characterData: true,
                      subtree: true,
                    });
                  }
                  textarea.dispatchEvent(
                    new KeyboardEvent('keydown', {
                      key: 's',
                      metaKey: true,
                      bubbles: true,
                    }),
                  );
                  await wait(1000);
                  return;
                }
                if (view.startsWith('mcp-editor')) {
                  const waitFor = async (selector) => {
                    const deadline = Date.now() + 5000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  const setInputValue = (input, value) => {
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLInputElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(input, value);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                  };
                  const mcpInputByLabel = (text) => {
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
                  const mcpInputsByLabelPrefix = (prefix) => [
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
                  const captureDisabledState = () => ({
                    ariaBusy:
                      document
                        .querySelector('.mcp-editor-feedback')
                        ?.getAttribute('aria-busy') ?? null,
                    busyText:
                      document.querySelector('.mcp-editor-busy')?.textContent?.trim() ??
                      null,
                    saveDisabled:
                      document.querySelector('.mcp-editor-save') instanceof
                      HTMLButtonElement
                        ? document.querySelector('.mcp-editor-save').disabled
                        : null,
                    removeDisabled:
                      document.querySelector('.mcp-editor-remove') instanceof
                      HTMLButtonElement
                        ? document.querySelector('.mcp-editor-remove').disabled
                        : null,
                    testDisabled:
                      document.querySelector('.mcp-editor-test-button') instanceof
                      HTMLButtonElement
                        ? document.querySelector('.mcp-editor-test-button').disabled
                        : null,
                    backDisabled:
                      document.querySelector('.mcp-editor-back') instanceof
                      HTMLButtonElement
                        ? document.querySelector('.mcp-editor-back').disabled
                        : null,
                    urlDisabled:
                      document.querySelector('.mcp-editor input[type="url"]') instanceof
                      HTMLInputElement
                        ? document.querySelector('.mcp-editor input[type="url"]').disabled
                        : null,
                  });
                  const installBusyTrace = () => {
                    window.__mcpEditorBusyTrace = [];
                    const feedback = document.querySelector('.mcp-editor-feedback');
                    if (!feedback) return;
                    const record = () => {
                      const trace = window.__mcpEditorBusyTrace;
                      const next = captureDisabledState();
                      const last = trace[trace.length - 1];
                      if (last && JSON.stringify(last) === JSON.stringify(next)) {
                        return;
                      }
                      trace.push(next);
                    };
                    record();
                    new MutationObserver(record).observe(feedback, {
                      attributes: true,
                      attributeFilter: ['aria-busy'],
                      childList: true,
                      subtree: true,
                    });
                  };
                  const openManageMcpTab = async () => {
                    document.querySelector('.sidebar-nav [data-nav-view=resources]')?.click();
                    const mcpTab = await waitFor('#resource-management-tab-mcp');
                    mcpTab?.click();
                    const selectedMcpTab = await waitFor(
                      '#resource-management-tab-mcp[aria-pressed="true"]',
                    );
                    const mcpPanel = await waitFor('#resource-management-panel-mcp:not([hidden])');
                    if (!selectedMcpTab || !mcpPanel) {
                      throw new Error('MCP management tab did not become selected.');
                    }
                    const readSeedRowByName = (serverName) => {
                      const seededRow = [
                        ...document.querySelectorAll('.resource-management-row'),
                      ].find(
                        (candidate) =>
                          candidate.querySelector('.resource-mcp-name')?.textContent?.trim() ===
                          serverName,
                      );
                      return seededRow
                        ? {
                            stateText:
                              seededRow
                                .querySelector('.resource-mcp-connection')
                                ?.textContent?.trim() ?? null,
                          }
                        : null;
                    };
                    // Zero-dial evidence (PR8 review F2/F3): both seeded rows
                    // must render their offline state ("Disabled"),
                    // proving the fixtures entered mcp.json with enabled:false
                    // and were never auto-connected at startup.
                    window.__mcpEditorSeedRow = readSeedRowByName(
                      'Artemis Smoke Remote',
                    );
                    window.__mcpEditorSeedStdioRow = readSeedRowByName(
                      'Artemis Smoke Local',
                    );
                  };
                  const openNewServerEditor = async () => {
                    await openManageMcpTab();
                    const addButton = [
                      ...document.querySelectorAll('.resource-add-button'),
                    ].find((button) =>
                      (button.textContent ?? '').trim().startsWith('Add server'),
                    );
                    if (!addButton) {
                      throw new Error(
                        'Add server button did not render: ' +
                          JSON.stringify({
                            selectedTab:
                              document
                                .querySelector('#resource-management-tab-mcp')
                                ?.getAttribute('aria-selected') ?? null,
                            panel:
                              document.querySelector(
                                '#resource-management-panel-mcp',
                              ) !== null,
                            actionLabels: [
                              ...document.querySelectorAll(
                                '#resource-management-panel-mcp button',
                              ),
                            ].map((button) => button.textContent?.trim() ?? ''),
                          }),
                      );
                    }
                    addButton.click();
                    await waitFor('.mcp-editor');
                    if (!document.querySelector('.mcp-editor')) {
                      throw new Error('MCP server editor did not open.');
                    }
                  };
                  const openSeededServerEditorByName = async (serverName) => {
                    await openManageMcpTab();
                    await waitFor('.resource-management-list .resource-management-row');
                    const row = [
                      ...document.querySelectorAll('.resource-management-row'),
                    ].find(
                      (candidate) =>
                        candidate.querySelector('.resource-mcp-name')?.textContent?.trim() ===
                        serverName,
                    );
                    if (!row) {
                      throw new Error(
                        'Seeded MCP server row did not render: ' + serverName,
                      );
                    }
                    row.querySelector('.resource-icon-button')?.click();
                    await waitFor('.mcp-editor');
                    await waitFor('.mcp-editor-test');
                    if (!document.querySelector('.mcp-editor-test')) {
                      throw new Error('Edit-mode test control did not render.');
                    }
                  };
                  const openSeededServerEditor = () =>
                    openSeededServerEditorByName('Artemis Smoke Remote');
                  if (view === 'mcp-editor-form-controls') {
                    await openSeededServerEditor();
                    const trigger = document.querySelector(
                      '.mcp-editor [data-artemis-component="select"] [data-part="trigger"]',
                    );
                    const selectRoot = trigger?.closest(
                      '[data-artemis-component="select"]',
                    );
                    if (
                      !(trigger instanceof HTMLButtonElement) ||
                      !selectRoot
                    ) {
                      throw new Error('Public MCP editor Select missing.');
                    }
                    return;
                  }
                  if (view === 'mcp-editor-new') {
                    await openNewServerEditor();
                    return;
                  }
                  if (view === 'mcp-editor-validation') {
                    await openNewServerEditor();
                    const command = mcpInputByLabel('Launch command');
                    if (!(command instanceof HTMLInputElement)) {
                      throw new Error('Launch command input did not render.');
                    }
                    setInputValue(command, '   ');
                    await wait(250);
                    document.querySelector('.mcp-editor-save')?.click();
                    await wait(300);
                    return;
                  }
                  if (view === 'mcp-editor-save' || view === 'mcp-editor-save-error') {
                    await openNewServerEditor();
                    const command = mcpInputByLabel('Launch command');
                    if (!(command instanceof HTMLInputElement)) {
                      throw new Error('Launch command input did not render.');
                    }
                    setInputValue(command, 'artemis-smoke-mcp-server');
                    await wait(300);
                    installBusyTrace();
                    document.querySelector('.mcp-editor-save')?.click();
                    await wait(1_200);
                    return;
                  }
                  if (view === 'mcp-editor-test-drift') {
                    await openSeededServerEditor();
                    const url = mcpInputByLabel('Server URL');
                    if (!(url instanceof HTMLInputElement)) {
                      throw new Error('Server URL input did not render.');
                    }
                    setInputValue(
                      url,
                      'https://mcp.artemis-smoke.example.test/mcp-drift',
                    );
                    await wait(400);
                    return;
                  }
                  if (view === 'mcp-editor-test-drift-stdio') {
                    await openSeededServerEditorByName('Artemis Smoke Local');
                    const readArgsDraft = () =>
                      mcpInputsByLabelPrefix('Arguments ').map(
                        (input) => input.value,
                      );
                    const readTestGate = () => {
                      const button = document.querySelector(
                        '.mcp-editor-test-button',
                      );
                      const hint = document.querySelector(
                        '.mcp-editor-test .mcp-editor-test-hint',
                      );
                      return {
                        testDisabled:
                          button instanceof HTMLButtonElement
                            ? button.disabled
                            : null,
                        testHintPresent: hint != null,
                        testHintText: hint?.textContent?.trim() ?? null,
                      };
                    };
                    window.__mcpEditorProbe = {
                      driftField: 'args',
                      before: {
                        argsValues: readArgsDraft(),
                        ...readTestGate(),
                      },
                    };
                    // Append a draft-only argument: Add argument -> --drift.
                    document
                      .querySelector('.mcp-editor .mcp-add-row')
                      ?.click();
                    await wait(200);
                    const added = mcpInputByLabel('Arguments 2');
                    if (!(added instanceof HTMLInputElement)) {
                      throw new Error('Added argument input did not render.');
                    }
                    setInputValue(added, '--drift');
                    await wait(400);
                    window.__mcpEditorProbe.drifted = {
                      argsValues: readArgsDraft(),
                      ...readTestGate(),
                    };
                    // A programmatic click on the drifted (disabled) control
                    // must stay a no-op: the main process counts reconnect
                    // IPC invocations and the audit asserts zero (PR8 F3).
                    document.querySelector('.mcp-editor-test-button')?.click();
                    await wait(500);
                    window.__mcpEditorProbe.afterClick = {
                      argsValues: readArgsDraft(),
                      ...readTestGate(),
                    };
                    // Revert the draft so it matches the saved config again.
                    mcpInputByLabel('Arguments 2')
                      ?.closest('.mcp-argument-row')
                      ?.querySelector('.mcp-remove-row')
                      ?.click();
                    await wait(400);
                    window.__mcpEditorProbe.reverted = {
                      argsValues: readArgsDraft(),
                      ...readTestGate(),
                    };
                    return;
                  }
                  if (view.startsWith('mcp-editor-test-')) {
                    await openSeededServerEditor();
                    document.querySelector('.mcp-editor-test-button')?.click();
                    await wait(view === 'mcp-editor-test-busy' ? 400 : 1_500);
                    return;
                  }
                  if (view === 'mcp-editor-remove-confirm') {
                    await openSeededServerEditor();
                    const readDialog = () => {
                      const dialog = document.querySelector('.confirmation-dialog');
                      return {
                        present: dialog !== null,
                        role: dialog?.getAttribute('role') ?? null,
                        tone: dialog?.getAttribute('class') ?? null,
                        message:
                          dialog
                            ?.querySelector('#confirmation-message')
                            ?.textContent?.trim() ?? null,
                        cancelLabel:
                          dialog
                            ?.querySelector('.secondary-button')
                            ?.textContent?.trim() ?? null,
                        confirmLabel:
                          dialog
                            ?.querySelector('.primary-button')
                            ?.textContent?.trim() ?? null,
                      };
                    };
                    document.querySelector('.mcp-editor-remove')?.click();
                    await waitFor('.confirmation-dialog.danger');
                    window.__mcpEditorProbe = { dialog: readDialog() };
                    document
                      .querySelector('.confirmation-actions .secondary-button')
                      ?.click();
                    await wait(400);
                    window.__mcpEditorProbe.rejection = {
                      dialogGone: document.querySelector('.confirmation-dialog') === null,
                      editorStillOpen: document.querySelector('.mcp-editor') !== null,
                    };
                    document.querySelector('.mcp-editor-remove')?.click();
                    await waitFor('.confirmation-dialog.danger');
                    return;
                  }
                  if (view === 'mcp-editor-remove' || view === 'mcp-editor-remove-error') {
                    await openSeededServerEditor();
                    installBusyTrace();
                    document.querySelector('.mcp-editor-remove')?.click();
                    await waitFor('.confirmation-dialog.danger');
                    document
                      .querySelector('.confirmation-actions .primary-button.danger')
                      ?.click();
                    if (view === 'mcp-editor-remove') {
                      await wait(1_500);
                      return;
                    }
                    await wait(1_000);
                    window.__mcpEditorProbe = {
                      injectedFailure: {
                        alertText:
                          document
                            .querySelector('.mcp-editor-action-error')
                            ?.textContent?.trim() ?? null,
                        retryDisabled:
                          document.querySelector(
                            '.mcp-editor-action-retry',
                          ) instanceof HTMLButtonElement
                            ? document.querySelector('.mcp-editor-action-retry').disabled
                            : null,
                        editorStillOpen:
                          document.querySelector('.mcp-editor') !== null,
                      },
                    };
                    document.querySelector('.mcp-editor-action-retry')?.click();
                    await wait(1_500);
                    return;
                  }
                  if (view === 'mcp-editor-credentials') {
                    await openSeededServerEditor();
                    window.__mcpEditorConsoleCapture = { entries: [] };
                    for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
                      const original = console[method].bind(console);
                      console[method] = (...args) => {
                        const text = args
                          .map((argument) => String(argument))
                          .join(' ');
                        window.__mcpEditorConsoleCapture.entries.push({
                          method,
                          length: text.length,
                          mentionsCredential: text.includes('artemis-smoke-bearer'),
                        });
                        original(...args);
                      };
                    }
                    const bearer = 'artemis-smoke-bearer-SYNTHETIC-NEVER-LEAK';
                    const input = document.querySelector(
                      '.mcp-editor input[type="password"]',
                    );
                    if (!(input instanceof HTMLInputElement)) {
                      throw new Error('Bearer input did not render.');
                    }
                    setInputValue(input, bearer);
                    await wait(300);
                    const scanForBearer = () => {
                      let textHits = 0;
                      const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                      );
                      while (walker.nextNode()) {
                        if (walker.currentNode.textContent?.includes(bearer)) {
                          textHits += 1;
                        }
                      }
                      let attributeHits = 0;
                      const attributeHitDetails = [];
                      for (const element of document.querySelectorAll('*')) {
                        for (const attribute of element.attributes) {
                          if (attribute.value.includes(bearer)) {
                            attributeHits += 1;
                            attributeHitDetails.push({
                              tag: element.tagName,
                              attribute: attribute.name,
                              maskedCredentialInput: element === input,
                            });
                          }
                        }
                      }
                      // React reflects a controlled input's value into its
                      // own value attribute, so the masked credential input
                      // may legitimately carry the token; serialize a clone
                      // with every password input removed to prove no other
                      // markup node ever exposes it.
                      const sanitizedClone =
                        document.documentElement.cloneNode(true);
                      for (const masked of sanitizedClone.querySelectorAll(
                        'input[type="password"]',
                      )) {
                        masked.remove();
                      }
                      return {
                        textHits,
                        attributeHits,
                        attributeHitDetails,
                        markupHits: sanitizedClone.outerHTML.includes(bearer)
                          ? 1
                          : 0,
                      };
                    };
                    window.__mcpEditorProbe = {
                      beforeSave: {
                        masked: input.type === 'password',
                        ...scanForBearer(),
                      },
                    };
                    document.querySelector('.mcp-editor-save')?.click();
                    const savedNotice = await waitFor(
                      '.resource-management-page ' +
                        '[data-artemis-component="inline-notice"]' +
                        '[data-tone="info"] [data-part="message"]',
                    );
                    if (!savedNotice || document.querySelector('.mcp-editor')) {
                      throw new Error('MCP credential save did not reach its completed state.');
                    }
                    window.__mcpEditorProbe.afterSave = scanForBearer();
                    window.__mcpEditorConsoleCapture.credentialEntries =
                      window.__mcpEditorConsoleCapture.entries.filter(
                        (entry) => entry.mentionsCredential,
                      ).length;
                    return;
                  }
                  return;
                }
                if (view.startsWith('turn-changes')) {
                  document.querySelector('.thread-select')?.click();
                  await wait(600);
                  if (view === 'turn-changes-form-controls') {
                    const deadline = Date.now() + 8_000;
                    let reviewAction = null;
                    while (Date.now() < deadline) {
                      reviewAction = document.querySelector(
                        '.turn-change-actions button:last-child',
                      );
                      if (reviewAction instanceof HTMLButtonElement && !reviewAction.disabled) break;
                      await wait(100);
                    }
                    if (!(reviewAction instanceof HTMLButtonElement) || reviewAction.disabled) {
                      throw new Error('Review action did not become available.');
                    }
                    reviewAction.click();
                    let scope = null;
                    while (Date.now() < deadline && scope === null) {
                      scope = document.querySelector('.review-scope-select [data-artemis-component="segmented-control"]');
                      if (scope === null) await wait(100);
                    }
                    if (!scope || scope.querySelectorAll('[data-part="segment"]').length < 4) {
                      throw new Error('Public Review SegmentedControl missing.');
                    }
                    return;
                  }
                  if (view === 'turn-changes-open') {
                    document.querySelector('.turn-execution-details > summary')?.click();
                    document.querySelector('.turn-change-more > summary')?.click();
                    await wait(400);
                  }
                  return;
                }
                if (view === 'message-actions-edit') {
                  await openSmokeHistoryThread('artemis-smoke-message-actions-thread');
                  const waitForMessageState = async (label, predicate) => {
                    const deadline = Date.now() + 8_000;
                    while (Date.now() < deadline) {
                      const result = predicate();
                      if (result) return result;
                      await wait(50);
                    }
                    throw new Error('message-actions-edit: timed out waiting for ' + label);
                  };
                  const edit = await waitForMessageState('enabled edit action', () => {
                    const button = document.querySelector(
                      '.user-message .message-action:nth-child(2)',
                    );
                    return button instanceof HTMLButtonElement && !button.disabled
                      ? button
                      : null;
                  });
                  edit.click();
                  await waitForMessageState('restored composer text', () => {
                    const composer = document.querySelector('.composer textarea');
                    return composer instanceof HTMLTextAreaElement && composer.value.length > 0;
                  });
                  return;
                }
                if (view.startsWith('environment')) {
                  const waitForEnvironment = async (description, predicate) => {
                    const deadline = Date.now() + 8_000;
                    while (Date.now() < deadline) {
                      const result = predicate();
                      if (result) return result;
                      await wait(50);
                    }
                    throw new Error(view + ': timed out waiting for ' + description + '; state=' + JSON.stringify({
                      userMessage: Boolean(document.querySelector('.user-message')),
                      messageAction: Boolean(document.querySelector('.user-message .message-action')),
                      environmentTrigger: Boolean(document.querySelector('.environment-trigger')),
                      historyFeedback: document.querySelector('.conversation-history-feedback')?.textContent ?? null,
                      selectedRows: [...document.querySelectorAll('[data-tree-row-id][aria-selected="true"]')].map((row) => row.getAttribute('data-tree-row-id')),
                      conversationText: document.querySelector('.workspace-content')?.textContent?.slice(0, 2000) ?? null,
                    }));
                  };
                  if (view === 'environment-unstarted' || view === 'environment-new-conversation') {
                    const thread = await waitForEnvironment('thread selector', () =>
                      document.querySelector('[data-tree-row-id="thread:artemis-smoke-environment-thread"] .thread-select'),
                    );
                    thread.click();
                    await wait(600);
                  } else {
                    await openSmokeHistoryThread('artemis-smoke-environment-thread', '.user-message .message-action');
                  }
                  if (view === 'environment-new-conversation') {
                    const create = document.querySelector('[data-tree-row-id="project:artemis-smoke-environment-project"] .project-new-thread');
                    if (!create) throw new Error('Project new conversation button missing.');
                    create.click();
                    await wait(350);
                    if (!document.querySelector('.conversation-empty-state')) throw new Error('New conversation did not reach the empty state: ' + create.outerHTML);
                    return;
                  }
                  if (view === 'environment-unstarted') return;
                  await waitForEnvironment('environment trigger', () =>
                    document.querySelector('.environment-trigger'),
                  );
                  if (view.startsWith('environment-non-git')) return;
                  if (view === 'environment-context-usage') {
                    document.querySelector('.context-usage-indicator')?.focus();
                    await wait(250);
                    return;
                  }
                  // Exercise manual actions after the automatic visibility check.
                  if (
                    !view.startsWith('environment-feedback') &&
                    view !== 'environment' &&
                    view !== 'environment-dock' &&
                    view !== 'environment-dock-open'
                  ) {
                    const trigger = document.querySelector('.environment-trigger');
                    if (trigger?.getAttribute('aria-expanded') !== 'true') {
                      trigger?.click();
                      await wait(500);
                    }
                  }
                  if (view.startsWith('environment-notice')) {
                    if (view.endsWith('-closed')) {
                      const close = await waitForEnvironment('environment close action', () =>
                        document.querySelector('.environment-panel-header .environment-header-action'),
                      );
                      close.click();
                      await waitForEnvironment('closed environment panel', () =>
                        document.querySelector('.environment-trigger')?.getAttribute('aria-expanded') === 'false',
                      );
                    }
                    navigator.clipboard.writeText = async () => {
                      throw new Error('This operation was aborted');
                    };
                    const copy = await waitForEnvironment('message copy action', () =>
                      document.querySelector('.user-message .message-action'),
                    );
                    copy.click();
                    await waitForEnvironment('copy error notice', () =>
                      document.querySelector('.transient-notice[role="alert"][data-tone="danger"]'),
                    );
                    return;
                  }
                  if (view === 'environment-closed') {
                    document.querySelector('.environment-panel-header .environment-header-action')?.click();
                    await wait(350);
                    return;
                  }
                  if (view === 'environment-open') {
                    const trigger = document.querySelector('.environment-trigger');
                    if (trigger?.getAttribute('aria-expanded') !== 'true') {
                      trigger?.click();
                      await wait(500);
                    }
                    return;
                  }
                  if (view === 'environment-branch-menu') {
                    const panelTrigger = document.querySelector('.environment-trigger');
                    if (panelTrigger?.getAttribute('aria-expanded') !== 'true') panelTrigger?.click();
                    const deadline = Date.now() + 10_000;
                    let trigger;
                    while (Date.now() < deadline) {
                      trigger = document.querySelector('.environment-branch-control > .environment-row');
                      if (trigger instanceof HTMLButtonElement && trigger.checkVisibility({ visibilityProperty: true })) break;
                      await wait(50);
                    }
                    if (!(trigger instanceof HTMLButtonElement) || !trigger.checkVisibility({ visibilityProperty: true })) throw new Error('Visible Environment branch trigger missing');
                    trigger.click();
                    while (Date.now() < deadline && !document.querySelector('.environment-branch-menu')) {
                      await wait(50);
                    }
                    if (!document.querySelector('.environment-branch-menu')) throw new Error('Environment branch menu did not open');
                    await wait(150);
                    return;
                  }
                  if (view === 'environment-agents') {
                    const popover = document.querySelector('.environment-popover');
                    if (popover) popover.scrollTop = 220;
                    await wait(500);
                    return;
                  }
                  if (view.startsWith('environment-pr-checks')) {
                    const trigger = document.querySelector('.environment-trigger');
                    if (trigger?.getAttribute('aria-expanded') !== 'true') {
                      trigger?.click();
                      await wait(500);
                    }
                    const deadline = Date.now() + 8_000;
                    let summary = null;
                    while (Date.now() < deadline && summary === null) {
                      summary = document.querySelector(
                        '.environment-pr-check-summary',
                      );
                      if (summary === null) await wait(100);
                    }
                    if (!(summary instanceof HTMLButtonElement)) {
                      throw new Error('Environment PR checks summary missing.');
                    }
                    summary.click();
                    await wait(500);
                    if (
                      !document.querySelector(
                        '.environment-checks-popover[data-artemis-component="popover"]',
                      )
                    ) {
                      throw new Error('Public Environment checks Popover missing.');
                    }
                    return;
                  }
                  if (view.startsWith('environment-feedback-approval')) {
                    const trigger = document.querySelector('.environment-trigger');
                    if (trigger?.getAttribute('aria-expanded') === 'true') {
                      trigger.click();
                      await wait(300);
                    }
                    const pending = view === 'environment-feedback-approval';
                    const completed = document.querySelector('.timeline-scroll details.turn-execution-details');
                    if (!pending && completed instanceof HTMLDetailsElement && !completed.open) {
                      completed.querySelector(':scope > summary')?.click();
                      await wait(350);
                    }
                    const selector = pending ? '.composer-decision .approval-decision' : '.timeline-scroll .decision-result';
                    const deadline = Date.now() + 8_000;
                    while (!document.querySelector(selector) && Date.now() < deadline) await wait(100);
                    const cards = [...document.querySelectorAll(selector)];
                    if (!cards.length) throw new Error('Approval decision surface missing.');
                    const reachable = async (element, scroll) => {
                      if (!(element instanceof HTMLElement) || !(scroll instanceof HTMLElement)) return false;
                      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
                      await wait(100);
                      const box = element.getBoundingClientRect();
                      const viewport = scroll.getBoundingClientRect();
                      return box.width > 0 && box.height > 0 &&
                        box.left >= viewport.left - 1 && box.right <= viewport.right + 1 &&
                        box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1 &&
                        element.scrollWidth <= element.clientWidth + 1;
                    };
                    const checks = [];
                    if (pending) {
                      const card = cards[0];
                      const scroll = card.closest('.composer-decision');
                      const parts = ['header strong', '.decision-title', '.decision-command', '.decision-waiting', '.decision-reason'];
                      for (const selector of parts) {
                        const part = card.querySelector(selector);
                        checks.push({ name: 'security-reachable-' + selector, pass: await reachable(part, scroll) });
                        if (selector !== '.decision-waiting' && selector !== 'header strong') checks.push({ name: 'bidi-' + selector, pass: !!part?.querySelector('bdi') });
                      }
                      const options = [...card.querySelectorAll('.decision-option')];
                      checks.push({ name: 'approval-options-present', pass: options.length >= 2 });
                      for (const option of options) {
                        option.focus();
                        checks.push({ name: 'approval-option-reachable', pass: document.activeElement === option && await reachable(option, scroll) });
                      }
                      checks.push({ name: 'feedback-reachable', pass: await reachable(card.querySelector('.decision-reply input'), scroll) });
                      const command = card.querySelector('.decision-command');
                      checks.push({ name: 'security-before-actions', pass: !!command && !!options[0] && command.getBoundingClientRect().bottom <= options[0].getBoundingClientRect().top + 1 });
                      card.scrollIntoView({ block: 'start' });
                      if (scroll) scroll.scrollTop = 0;
                    } else {
                      for (const card of cards) {
                        const scroll = card.closest('.timeline-scroll');
                        const summary = card.querySelector(':scope > summary');
                        checks.push({ name: 'native-collapsed-result', pass: card instanceof HTMLDetailsElement && !card.open });
                        checks.push({ name: 'result-summary-reachable', pass: await reachable(summary, scroll) });
                        summary?.click();
                        await wait(100);
                        checks.push({ name: 'native-result-expanded', pass: card instanceof HTMLDetailsElement && card.open });
                        const detail = card.querySelector('.decision-result-detail');
                        const parts = detail ? [...detail.children] : [];
                        checks.push({ name: 'result-details-present', pass: parts.length > 0 });
                        for (const part of parts) checks.push({ name: 'result-detail-reachable', pass: await reachable(part, scroll) });
                      }
                    }
                    window.__decisionApprovalVerification = { count: cards.length, checks };
                    return;
                  }
                  if (view === 'environment-sources' || view === 'environment-sources-image') {
                    const popover = document.querySelector('.environment-popover');
                    if (popover) popover.scrollTop = popover.scrollHeight;
                    await wait(350);
                    document
                      .querySelector('.sources-section .environment-view-all')
                      ?.click();
                    await wait(700);
                    if (view === 'environment-sources-image') {
                      document
                        .querySelector('button.sources-panel-entry.attachment')
                        ?.click();
                      await wait(500);
                    }
                    return;
                  }
                  if (
                    view === 'environment-commit-dialog' ||
                    view === 'environment-commit-branch-menu' ||
                    view === 'environment-commit-new-branch' ||
                    view === 'environment-commit-execute' ||
                    view === 'environment-commit-new-branch-execute' ||
                    view === 'environment-commit-and-push-execute' ||
                    view === 'environment-push-execute'
                  ) {
                    document.querySelector('.commit-push-row')?.click();
                    await wait(500);
                    if (
                      view === 'environment-commit-branch-menu' ||
                      view === 'environment-commit-new-branch' ||
                      view === 'environment-commit-new-branch-execute'
                    ) {
                      document
                        .querySelector('.environment-git-destination-trigger')
                        ?.click();
                      await wait(350);
                    }
                    if (
                      view === 'environment-commit-new-branch' ||
                      view === 'environment-commit-new-branch-execute'
                    ) {
                      document
                        .querySelector(
                          '.environment-git-destination-menu button:last-child',
                        )
                        ?.click();
                      await wait(350);
                    }
                    if (
                      view === 'environment-commit-execute' ||
                      view === 'environment-commit-new-branch-execute'
                    ) {
                      document
                        .querySelector('.environment-git-actions button.primary')
                        ?.click();
                      await wait(1_000);
                    }
                    if (view === 'environment-commit-and-push-execute') {
                      document
                        .querySelector(
                          '.environment-git-actions button:nth-child(2)',
                        )
                        ?.click();
                      await wait(350);
                      document
                        .querySelector('.confirmation-actions .primary-button')
                        ?.click();
                      await wait(1_200);
                    }
                    if (view === 'environment-push-execute') {
                      document
                        .querySelector(
                          '.environment-git-actions button:nth-child(3)',
                        )
                        ?.click();
                      await wait(350);
                      document
                        .querySelector('.confirmation-actions .primary-button')
                        ?.click();
                      await wait(1_200);
                    }
                    return;
                  }
                  if (view === 'environment-outside-click') {
                    document.querySelector('.timeline-scroll')?.dispatchEvent(
                      new PointerEvent('pointerdown', {
                        bubbles: true,
                        pointerId: 1,
                        pointerType: 'mouse',
                      }),
                    );
                    await wait(500);
                    return;
                  }
                  if (
                    view === 'environment-dock' ||
                    view === 'environment-dock-open' ||
                    view === 'environment-dock-workspace'
                  ) {
                    const workspaceDockSelector =
                      '[data-artemis-component="workspace-dock"]';
                    const bounds = (selector) => {
                      const rect = document
                        .querySelector(selector)
                        ?.getBoundingClientRect();
                      return rect
                        ? { left: rect.left, right: rect.right, width: rect.width }
                        : null;
                    };
                    const before = {
                      status: bounds('.status-pill'),
                      environment: bounds('.environment-trigger'),
                      dock: bounds(workspaceDockSelector),
                    };
                    const workspaceDock = document.querySelector(
                      workspaceDockSelector,
                    );
                    document.querySelector('.right-sidebar-toggle')?.click();
                    await new Promise((resolve) =>
                      requestAnimationFrame(resolve),
                    );
                    const dockAnimations = (workspaceDock?.getAnimations() ?? [])
                      .map((animation) => ({
                        animation,
                        duration: Number(
                          animation.effect?.getComputedTiming().duration ?? 0,
                        ),
                        property: animation.transitionProperty ?? null,
                      }))
                      .filter(({ duration }) => duration > 0);
                    for (const { animation, duration } of dockAnimations) {
                      animation.pause();
                      animation.currentTime = duration / 2;
                    }
                    await new Promise((resolve) =>
                      requestAnimationFrame(resolve),
                    );
                    const middle = {
                      status: bounds('.status-pill'),
                      environment: bounds('.environment-trigger'),
                      dock: bounds(workspaceDockSelector),
                    };
                    for (const { animation } of dockAnimations) {
                      animation.finish();
                    }
                    await new Promise((resolve) =>
                      requestAnimationFrame(resolve),
                    );
                    const after = {
                      status: bounds('.status-pill'),
                      environment: bounds('.environment-trigger'),
                      dock: bounds(workspaceDockSelector),
                    };
                    window.__artemisSmokeDockTransition = {
                      before,
                      middle,
                      after,
                      animations: dockAnimations.map(
                        ({ duration, property }) => ({ duration, property }),
                      ),
                    };
                  }
                  if (view === 'environment-dock-open') {
                    document.querySelector('.environment-trigger')?.click();
                    await wait(500);
                  }
                  return;
                }
                if (view.startsWith('temporary')) {
                  if (view === 'temporary-double-toggle') {
                    const disclosure = document.querySelector(
                      '.temporary-conversations .project-group-select',
                    );
                    disclosure?.click();
                    disclosure?.click();
                    await wait(800);
                    return;
                  }
                  if (view === 'temporary-collapsed') {
                    document
                      .querySelector(
                        '.temporary-conversations .project-group-select',
                      )
                      ?.click();
                    await wait(600);
                    return;
                  }
                  document
                    .querySelector('.temporary-conversations .project-new-thread')
                    ?.click();
                  await wait(600);
                  if (view === 'temporary-dock') {
                    document.querySelector('.right-sidebar-toggle')?.click();
                    await wait(500);
                  }
                  return;
                }
                if (view.startsWith('workspace-tab-menu')) {
                  document.querySelector('.right-sidebar-toggle')?.click();
                  await wait(500);
                  const addButton = document.querySelector('.workspace-tab-add');
                  addButton?.click();
                  await wait(300);
                  if (
                    !addButton ||
                    addButton.getAttribute('aria-expanded') !== 'true' ||
                    !document.querySelector('.workspace-tab-menu')
                  ) {
                    throw new Error('Workspace tab menu did not open.');
                  }
                  if (view === 'workspace-tab-menu-outside-click') {
                    const outsideTarget = document.querySelector(
                      '.workspace-tab-content',
                    );
                    if (!outsideTarget) {
                      throw new Error('Workspace tab outside-click target missing.');
                    }
                    outsideTarget.dispatchEvent(
                      new PointerEvent('pointerdown', {
                        bubbles: true,
                        pointerId: 1,
                        pointerType: 'mouse',
                      }),
                    );
                  } else if (view === 'workspace-tab-menu-escape') {
                    window.dispatchEvent(new KeyboardEvent('keydown', {
                      key: 'Escape',
                    }));
                  }
                  await wait(500);
                  if (
                    document.querySelector('.workspace-tab-menu') ||
                    document
                      .querySelector('.workspace-tab-add')
                      ?.getAttribute('aria-expanded') !== 'false'
                  ) {
                    throw new Error(
                      'Workspace tab menu remained open after dismissal.',
                    );
                  }
                  return;
                }
                if (view === 'card-heatmap') {
                  const waitForSelector = async (selector) => {
                    const deadline = Date.now() + 5000;
                    while (Date.now() < deadline) {
                      const found = document.querySelector(selector);
                      if (found) return found;
                      await wait(100);
                    }
                    return null;
                  };
                  document.querySelector('.sidebar-nav [data-nav-view=token-usage]')?.click();
                  await waitForSelector(
                    '[data-artemis-component="data-heatmap"] [data-part="grid"]',
                  );
                  document
                    .querySelector('.token-usage-summary')
                    ?.scrollIntoView({ block: 'start' });
                  await wait(300);
                  // Focus today's cell (the last grid column) so the
                  // checklist §6 focus-tooltip evidence lands in both the
                  // screenshot and the audit: the tooltip DOM commits
                  // during this wait, before the capture chain runs.
                  const grid = document.querySelector(
                    '[data-artemis-component="data-heatmap"] [data-part="grid"]',
                  );
                  const cells = [
                    ...(grid?.querySelectorAll('[role="gridcell"]') ?? []),
                  ];
                  const finalColumn = Math.max(
                    ...cells.map((cell) =>
                      Number(cell.getAttribute('aria-colindex') ?? 0),
                    ),
                  );
                  const lastCell = cells.find(
                    (cell) =>
                      Number(cell.getAttribute('aria-colindex')) === finalColumn,
                  );
                  if (lastCell instanceof HTMLButtonElement) {
                    lastCell.focus();
                  }
                  await wait(400);
                  return;
                }
                if (view === 'token-usage' || view === 'navigation-token-usage') {
                  document.querySelector('.sidebar-nav [data-nav-view=token-usage]')?.click();
                  await wait(1_000);
                  const page = document.querySelector('.token-usage-page');
                  if (page) page.scrollTop = page.scrollHeight;
                  await wait(300);
                  return;
                }
                document.querySelector('.sidebar-nav [data-nav-view=resources]')?.click();
                await wait(1_000);
                if (view === 'add-plugin') {
                  document.querySelector('.resource-add-button')?.click();
                  await wait(500);
                } else if (view === 'add-mcp') {
                  document.querySelector('#resource-management-tab-mcp')?.click();
                  await wait(300);
                  clickByText('.resource-add-button', 'Add server');
                  await wait(500);
                } else if (view === 'mcp-context7-install') {
                  document.querySelector('#resource-management-tab-mcp')?.click();
                  await wait(300);
                  document
                    .querySelector('.resource-list-heading-actions .resource-add-button')
                    ?.click();
                  await wait(300);
                  const input = document.querySelector(
                    '.resource-discovery-panel input',
                  );
                  if (input instanceof HTMLInputElement) {
                    const setter = Object.getOwnPropertyDescriptor(
                      HTMLInputElement.prototype,
                      'value',
                    )?.set;
                    setter?.call(input, 'context7');
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.form?.requestSubmit();
                    await wait(2_500);
                    const row = [...document.querySelectorAll(
                      '.resource-discovery-row',
                    )].find(
                      (candidate) =>
                        candidate.querySelector('strong')?.textContent?.trim() ===
                        'Context7',
                    );
                    row?.querySelector('button')?.click();
                    await wait(500);
                  }
                } else if (
                  view.startsWith('mcp-search-') ||
                  view.startsWith('skill-search-')
                ) {
                  const tab = view.startsWith('mcp-search-') ? 'mcp' : 'skills';
                  const tabButton = document.querySelector('#resource-management-tab-' + tab);
                  if (!(tabButton instanceof HTMLButtonElement)) {
                    throw new Error('Resource search tab did not render: ' + tab);
                  }
                  tabButton.click();
                  await wait(300);
                  document
                    .querySelector('.resource-list-heading-actions .resource-add-button')
                    ?.click();
                  await wait(300);
                  const input = document.querySelector(
                    '.resource-discovery-panel input',
                  );
                  if (!(input instanceof HTMLInputElement)) {
                    throw new Error('Resource catalog search input did not render: ' + tab);
                  }
                  const setter = Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    'value',
                  )?.set;
                  setter?.call(input, 'artemis-no-results-smoke');
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  await wait(50);
                  input.form?.requestSubmit();
                  const component = view.endsWith('-loading') ? 'loading-state' : 'empty-state';
                  const selector = '.resource-discovery-results [data-artemis-component="' + component + '"]';
                  const deadline = Date.now() + 5_000;
                  while (!document.querySelector(selector) && Date.now() < deadline) {
                    await wait(50);
                  }
                  const status = document.querySelector(selector);
                  if (!status) {
                    throw new Error('Resource catalog search feedback did not render: ' + view);
                  }
                  status.scrollIntoView({ block: 'center' });
                  await wait(300);
                }
              })()
            `;
}

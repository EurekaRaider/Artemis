import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import type { BrowserSessionHost } from "./browser-session-host.js";
import { BROWSER_SESSION_PARTITION } from "../../shared/i18n/browser-locale.js";
import { selectSmokeWorkspaceMenu } from "./smoke-workspace-menu.js";

export async function driveSmokeWorkspaceDockEvidence(
  window: BrowserWindow,
  view: string | undefined,
  browsers?: BrowserSessionHost,
): Promise<void> {
  if (view !== "environment-dock-workspace") return;

  const browserFailureUrl =
    process.env.ARTEMIS_SMOKE_BROWSER_FAILURE_URL ??
    "http://127.0.0.1:65535/artemis-mig4-error";
  if (
    !/^http:\/\/127\.0\.0\.1:\d+\/artemis-mig4-error$/u.test(browserFailureUrl)
  ) {
    throw new Error("Workspace Dock smoke failure URL must use loopback HTTP.");
  }

  const contents = window.webContents;
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const evaluate = async <T>(script: string): Promise<T> =>
    (await contents.executeJavaScript(script)) as T;
  const pressKey = async (keyCode: string): Promise<void> => {
    const keyDetails = {
      ArrowLeft: { code: "ArrowLeft", virtualKeyCode: 37 },
      ArrowRight: { code: "ArrowRight", virtualKeyCode: 39 },
      Home: { code: "Home", virtualKeyCode: 36 },
      End: { code: "End", virtualKeyCode: 35 },
    }[keyCode];
    if (!keyDetails) throw new Error(`Unsupported Workspace key ${keyCode}.`);
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    const parameters = {
      key: keyCode,
      code: keyDetails.code,
      windowsVirtualKeyCode: keyDetails.virtualKeyCode,
      nativeVirtualKeyCode: keyDetails.virtualKeyCode,
    };
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "rawKeyDown",
    });
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "keyUp",
    });
    await evaluate(`window.__workspaceDockWaitForLayout('open')`);
  };

  if (process.platform === "darwin") app.focus({ steal: true });
  window.focus();
  contents.focus();
  await evaluate<void>(`(async () => {
    const wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const dockSelector = '[data-artemis-component="workspace-dock"]';
    const resizerSelector =
      '[data-artemis-component="workspace-dock-resizer"]';
    const tabSelector = '[data-artemis-component="workspace-tab"]';
    const capture = () => {
      const dock = document.querySelector(dockSelector);
      const resizer = document.querySelector(resizerSelector);
      const conversation = document.querySelector(
        '[data-artemis-component="conversation-surface"]',
      );
      const workspaceContent = document.querySelector('.workspace-content');
      const timeline = document.querySelector('.timeline-scroll');
      const browserSurface = document.querySelector(
        '[data-artemis-component="browser-surface"]',
      );
      const browserToolbar = document.querySelector(
        '[data-artemis-component="browser-toolbar"]',
      );
      const browserNavigation = document.querySelector(
        '[data-artemis-component="browser-navigation"]',
      );
      const browserAddressForm = document.querySelector(
        '[data-artemis-component="browser-address-form"]',
      );
      const browserAddressInput = document.querySelector(
        '[data-artemis-component="browser-address-input"]',
      );
      const browserViewport = document.querySelector(
        '[data-artemis-component="browser-viewport"]',
      );
      const browserFrame = document.querySelector('.browser-frame');
      const dockBounds = dock?.getBoundingClientRect();
      const resizerBounds = resizer?.getBoundingClientRect();
      const conversationBounds = conversation?.getBoundingClientRect();
      const workspaceContentBounds = workspaceContent?.getBoundingClientRect();
      const timelineBounds = timeline?.getBoundingClientRect();
      const browserSurfaceBounds = browserSurface?.getBoundingClientRect();
      const browserToolbarBounds = browserToolbar?.getBoundingClientRect();
      const browserViewportBounds = browserViewport?.getBoundingClientRect();
      const resizerStyle = resizer ? getComputedStyle(resizer) : null;
      const tabs = [...document.querySelectorAll(tabSelector)].map((tab) => {
        const select = tab.querySelector(':scope > [data-part="select"]');
        const close = tab.querySelector(':scope > [data-part="close"]');
        return {
          label: select?.textContent?.trim() ?? '',
          active: tab.getAttribute('data-state') === 'active',
          selected: select?.getAttribute('aria-selected') ?? null,
          tabIndex: select instanceof HTMLElement ? select.tabIndex : null,
          closeLabel: close?.getAttribute('aria-label') ?? null,
          selectFocused: document.activeElement === select,
        };
      });
      return {
        direction: getComputedStyle(document.documentElement).direction,
        viewport: {
          compactMedia: matchMedia('(max-width: 820px)').matches,
          devicePixelRatio: window.devicePixelRatio,
          innerWidth: window.innerWidth,
          outerWidth: window.outerWidth,
        },
        dock: dockBounds
          ? {
              state: dock?.getAttribute('data-state') ?? null,
              ariaHidden: dock?.getAttribute('aria-hidden') ?? null,
              inert: dock?.hasAttribute('inert') ?? null,
              visible:
                getComputedStyle(dock).visibility !== 'hidden' &&
                dockBounds.width > 0,
              left: dockBounds.left,
              right: dockBounds.right,
              width: dockBounds.width,
            }
          : null,
        resizer: resizerBounds
          ? {
              state: resizer?.getAttribute('data-state') ?? null,
              role: resizer?.getAttribute('role') ?? null,
              controls: resizer?.getAttribute('aria-controls') ?? null,
              label: resizer?.getAttribute('aria-label') ?? null,
              minimum: Number(resizer?.getAttribute('aria-valuemin')),
              maximum: Number(resizer?.getAttribute('aria-valuemax')),
              value: Number(resizer?.getAttribute('aria-valuenow')),
              valueText: resizer?.getAttribute('aria-valuetext') ?? null,
              tabIndex:
                resizer instanceof HTMLElement ? resizer.tabIndex : null,
              display: resizerStyle?.display ?? null,
              visibility: resizerStyle?.visibility ?? null,
              left: resizerBounds.left,
              right: resizerBounds.right,
              width: resizerBounds.width,
            }
          : null,
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
        timeline: timelineBounds
          ? {
              left: timelineBounds.left,
              right: timelineBounds.right,
              width: timelineBounds.width,
            }
          : null,
        launcherActions: document.querySelectorAll(
          '[data-artemis-component="workspace-launcher"] [data-part="action"]',
        ).length,
        selectionText: window.getSelection()?.toString() ?? '',
        browser: browserSurfaceBounds
          ? {
              addressDirection:
                browserAddressInput instanceof HTMLElement
                  ? getComputedStyle(browserAddressInput).direction
                  : null,
              addressValue:
                browserAddressInput instanceof HTMLInputElement
                  ? browserAddressInput.value
                  : null,
              ariaBusy: browserSurface?.getAttribute('aria-busy') ?? null,
              backDisabled:
                document.querySelector('.browser-back-button')?.hasAttribute(
                  'disabled',
                ) ?? null,
              forwardDisabled:
                document
                  .querySelector('.browser-forward-button')
                  ?.hasAttribute('disabled') ?? null,
              framePartition: ${JSON.stringify(BROWSER_SESSION_PARTITION)},
              framePresent: browserFrame !== null,
              frameSource: browserFrame?.dataset.browserUrl ?? null,
              frameUrl: browserFrame?.dataset.browserUrl ?? null,
              goDisabled:
                document.querySelector('.browser-go-button')?.hasAttribute(
                  'disabled',
                ) ?? null,
              markersComplete:
                browserToolbar !== null &&
                browserNavigation !== null &&
                browserAddressForm !== null &&
                browserAddressInput !== null &&
                browserViewport !== null &&
                document.querySelectorAll(
                  '[data-artemis-component="browser-navigation-button"]',
                ).length === 3 &&
                document.querySelector(
                  '.browser-toolbar .browser-refresh-button[data-artemis-component="browser-navigation-button"]',
                ) instanceof HTMLButtonElement &&
                document.querySelector(
                  '[data-artemis-component="browser-go-button"]',
                ) !== null,
              refreshDisabled:
                document
                  .querySelector('.browser-refresh-button')
                  ?.hasAttribute('disabled') ?? null,
              errorText:
                document.querySelector('.browser-error')?.textContent?.trim() ??
                null,
              state: browserSurface?.getAttribute('data-state') ?? null,
              surface: {
                width: browserSurfaceBounds.width,
                height: browserSurfaceBounds.height,
                scrollWidth:
                  browserSurface instanceof HTMLElement
                    ? browserSurface.scrollWidth
                    : null,
              },
              toolbar: browserToolbarBounds
                ? {
                    width: browserToolbarBounds.width,
                    height: browserToolbarBounds.height,
                    scrollWidth:
                      browserToolbar instanceof HTMLElement
                        ? browserToolbar.scrollWidth
                        : null,
                  }
                : null,
              viewport: browserViewportBounds
                ? {
                    width: browserViewportBounds.width,
                    height: browserViewportBounds.height,
                  }
                : null,
            }
          : null,
        tabs,
      };
    };
    const waitForLayout = async (state) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await wait(50);
        const snapshot = capture();
        const expectedWidth = snapshot.viewport.compactMedia
          ? snapshot.workspaceContent?.width
          : snapshot.resizer?.value;
        const settled = state === 'closed'
          ? snapshot.dock?.visible === false
          : Number.isFinite(expectedWidth) &&
            Math.abs(expectedWidth - snapshot.dock?.width) <= 0.5;
        if (snapshot.dock?.state === state && settled) return;
      }
      throw new Error('Workspace Dock layout did not settle: ' + state + ' ' +
        JSON.stringify({ snapshot: capture(), animations:
          document.querySelector(dockSelector)?.getAnimations().map((animation) => ({
            state: animation.playState, time: animation.currentTime,
            timing: animation.effect?.getComputedTiming(),
          })),
        }));
    };
    window.__workspaceDockWaitForLayout = waitForLayout;


    for (let index = 0; index < 8; index += 1) {
      const existingClose = document.querySelector(
        tabSelector + ' > [data-part="close"]',
      );
      if (!(existingClose instanceof HTMLButtonElement)) break;
      existingClose.click();
      await wait(240);
    }
    if (document.querySelector(tabSelector)) {
      throw new Error('Workspace tabs did not reach the empty state.');
    }
    const dockToggle = document.querySelector('.right-sidebar-toggle');
    if (!(dockToggle instanceof HTMLButtonElement)) {
      throw new Error('Workspace Dock toggle missing.');
    }
    if (dockToggle?.getAttribute('aria-expanded') !== 'true') {
      dockToggle.click();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await wait(100);
        const currentToggle = document.querySelector('.right-sidebar-toggle');
        const currentDock = document.querySelector(dockSelector);
        if (
          currentToggle?.getAttribute('aria-expanded') === 'true' &&
          currentDock?.getAttribute('data-state') === 'open'
        ) {
          break;
        }
      }
    }
    if (
      document.querySelector('.right-sidebar-toggle')?.getAttribute(
        'aria-expanded',
      ) !== 'true' ||
      document.querySelector(dockSelector)?.getAttribute('data-state') !==
        'open'
    ) {
      throw new Error('Workspace Dock did not open before capture.');
    }
    await waitForLayout('open');
    window.__workspaceDockCapture = capture;
    window.__workspaceDockInitial = capture();
  })()`);
  await selectSmokeWorkspaceMenu(window, "review");
  await selectSmokeWorkspaceMenu(window, "browser");
  const resizePoint = await evaluate<{
    direction: "ltr" | "rtl";
    layout: "overlay" | "resizable";
    x: number | null;
    y: number | null;
  }>(`(async () => {
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const capture = window.__workspaceDockCapture;
    const initial = window.__workspaceDockInitial;
    const tabSelector = '[data-artemis-component="workspace-tab"]';
    const resizerSelector = '[data-artemis-component="workspace-dock-resizer"]';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const browserReady =
        document.querySelector(
          '[data-artemis-component="browser-surface"][data-state="ready"]',
        ) !== null &&
        document.querySelector('.browser-refresh-button')?.hasAttribute(
          'disabled',
        ) === false &&
        document.querySelector('.browser-go-button')?.hasAttribute(
          'disabled',
        ) === false;
      if (browserReady) break;
      await wait(120);
    }
    const multiTab = capture();
    const firstTab = document.querySelector(tabSelector);
    const firstSelect = firstTab?.querySelector(':scope > [data-part="select"]');
    if (!(firstSelect instanceof HTMLButtonElement)) {
      throw new Error('First workspace tab select button missing.');
    }
    firstSelect.click();
    await wait(160);
    const firstClose = firstTab?.querySelector(':scope > [data-part="close"]');
    if (!(firstClose instanceof HTMLButtonElement)) {
      throw new Error('First workspace tab close button missing.');
    }
    firstClose.click();
    await wait(360);
    const afterClose = capture();
    const resizer = document.querySelector(resizerSelector);
    const bounds = resizer?.getBoundingClientRect();
    if (!(resizer instanceof HTMLElement) || !bounds) {
      throw new Error('Workspace Dock resizer missing before interaction.');
    }
    const compactMedia = matchMedia('(max-width: 820px)').matches;
    const resizerDisplay = getComputedStyle(resizer).display;
    if (compactMedia) {
      if (resizerDisplay !== 'none' || bounds.width !== 0) {
        throw new Error('Compact Workspace Dock did not hide its resizer.');
      }
    } else if (resizerDisplay === 'none' || bounds.width <= 0) {
      throw new Error('Resizable Workspace Dock did not expose its resizer.');
    }
    window.__workspaceDockPointerProbe = { down: 0, move: 0, up: 0 };
    if (!compactMedia) {
      resizer.addEventListener('pointerdown', () => {
        window.__workspaceDockPointerProbe.down += 1;
      });
      resizer.addEventListener('pointermove', () => {
        window.__workspaceDockPointerProbe.move += 1;
      });
      resizer.addEventListener('pointerup', () => {
        window.__workspaceDockPointerProbe.up += 1;
      });
    }
    window.__workspaceDockCapture = capture;
    window.__workspaceDockInteraction = {
      initial,
      multiTab,
      afterClose,
      layout: compactMedia ? 'overlay' : 'resizable',
    };
    return {
      direction: getComputedStyle(document.documentElement).direction,
      layout: compactMedia ? 'overlay' : 'resizable',
      x: compactMedia ? null : Math.round(bounds.left + bounds.width / 2),
      y: compactMedia ? null : Math.round(bounds.top + bounds.height / 2),
    };
  })()`);

  const browserServer = createServer((request, response) => {
    const marker = request.url === "/one" ? "one" : "two";
    response.setHeader("Content-Type", "text/html");
    response.end(
      `<title>Artemis ${marker}</title><style>html,body{background:white;color:black}</style><p>artemis-browser-${marker}</p>`,
    );
  });
  await new Promise<void>((resolve) =>
    browserServer.listen(0, "127.0.0.1", resolve),
  );
  const browserAddress = browserServer.address();
  if (!browserAddress || typeof browserAddress === "string")
    throw new Error("Synthetic browser server is unavailable");
  const browserBase = `http://127.0.0.1:${browserAddress.port}`;
  try {
    await evaluate(`(async () => {
    const wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const waitFor = async (predicate, label, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await wait(100);
      }
      throw new Error('Browser interaction timed out: ' + label + '.');
    };
    const node = document.querySelector('.browser-frame');
    const threadId = node?.dataset.browserThread, tabId = node?.dataset.browserTab;
    let current = await window.artemis.browserSession({action:'snapshot',threadId,tabId});
    const frame = {
      loadURL: async (url) => { current = await window.artemis.browserSession({action:'navigate',threadId,tabId,url}); },
      getURL: () => current.url,
    };
    const surface = document.querySelector(
      '[data-artemis-component="browser-surface"]',
    );
    const address = document.querySelector('.browser-address-input');
    const form = document.querySelector('.browser-address-form');
    const go = document.querySelector('.browser-go-button');
    const back = document.querySelector('.browser-back-button');
    const forward = document.querySelector('.browser-forward-button');
    const refresh = document.querySelector('.browser-refresh-button');
    if (
      !(node instanceof HTMLElement) ||
      !(surface instanceof HTMLElement) ||
      !(address instanceof HTMLInputElement) ||
      !(form instanceof HTMLFormElement) ||
      !(go instanceof HTMLButtonElement) ||
      !(back instanceof HTMLButtonElement) ||
      !(forward instanceof HTMLButtonElement) ||
      !(refresh instanceof HTMLButtonElement)
    ) {
      throw new Error('Browser interaction controls are incomplete.');
    }
    const controls = { back: 0, forward: 0, go: 0, refresh: 0, submit: 0 };
    const events = { failures: [], navigations: [], starts: 0, stops: 0 };
    const surfaceStates = [];
    const recordSurface = () => {
      const state = surface.getAttribute('data-state');
      if (state && surfaceStates.at(-1) !== state) surfaceStates.push(state);
    };
    recordSurface();
    const observer = new MutationObserver(recordSurface);
    observer.observe(surface, {
      attributeFilter: ['aria-busy', 'data-state'],
      attributes: true,
      childList: true,
      subtree: true,
    });
    const onStart = () => {
      events.starts += 1;
    };
    const onStop = () => {
      events.stops += 1;
    };
    const onFailure = (event) => {
      if (event.errorCode !== -3) {
        events.failures.push({
          code: event.errorCode,
          description: event.errorDescription,
          url: event.validatedURL,
        });
      }
    };
    const onNavigate = (event) => {
      events.navigations.push(event.url);
    };
    const unsubscribe = window.artemis.onBrowserSession(value => {
      if(value.threadId!==threadId || value.tabId!==tabId)return;
      if(value.loading && !current.loading)onStart();
      if(!value.loading && current.loading)onStop();
      if(value.error && value.error!==current.error)onFailure({errorCode:Number(value.error.match(/\\((-?\\d+)\\)/)?.[1] ?? -2),errorDescription:value.error,validatedURL:value.url});
      if(value.url!==current.url)onNavigate({url:value.url});
      current=value;
    });
    go.addEventListener('click', () => {
      controls.go += 1;
    });
    back.addEventListener('click', () => {
      controls.back += 1;
    });
    forward.addEventListener('click', () => {
      controls.forward += 1;
    });
    refresh.addEventListener('click', () => {
      controls.refresh += 1;
    });
    form.addEventListener('submit', () => {
      controls.submit += 1;
    });

    const failureUrl = ${JSON.stringify(browserFailureUrl)};
    const addressSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    addressSetter?.call(address, failureUrl);
    address.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => address.value === failureUrl, 'address input');
    const failureBaseline = events.failures.length;
    go.click();
    await waitFor(
      () =>
        controls.submit === 1 &&
        events.failures.length > failureBaseline &&
        surface.getAttribute('data-state') === 'error',
      'submitted loading/error state',
      30_000, // Windows loopback connection refusal can exceed ten seconds.
    );
    recordSurface();
    const submission = {
      address: address.value,
      errorText:
        document.querySelector('.browser-error')?.textContent?.trim() ?? null,
      failure: events.failures.at(-1) ?? null,
      state: surface.getAttribute('data-state'),
    };

    const firstUrl = ${JSON.stringify(browserBase + "/one")};
    const secondUrl = ${JSON.stringify(browserBase + "/two")};
    const load = async (url, label) => {
      const stopBaseline = events.stops;
      await frame.loadURL(url);
      await waitFor(
        () =>
          frame.getURL() === url &&
          events.stops > stopBaseline &&
          surface.getAttribute('data-state') === 'ready',
        label,
      );
    };
    await load(firstUrl, 'first synthetic document');
    await load(secondUrl, 'second synthetic document');
    await waitFor(() => !back.disabled, 'back control enabled');
    const beforeBack = frame.getURL();
    const backStopBaseline = events.stops;
    back.click();
    await waitFor(
      () =>
        frame.getURL() === firstUrl &&
        !forward.disabled &&
        events.stops > backStopBaseline &&
        surface.getAttribute('data-state') === 'ready',
      'back navigation',
    );
    const afterBack = frame.getURL();
    const forwardStopBaseline = events.stops;
    forward.click();
    await waitFor(
      () =>
        frame.getURL() === secondUrl &&
        events.stops > forwardStopBaseline &&
        surface.getAttribute('data-state') === 'ready',
      'forward navigation',
    );
    const afterForward = frame.getURL();
    const reloadStartBaseline = events.starts;
    const reloadStopBaseline = events.stops;
    refresh.click();
    await waitFor(
      () =>
        events.starts > reloadStartBaseline &&
        events.stops > reloadStopBaseline &&
        frame.getURL() === secondUrl &&
        surface.getAttribute('data-state') === 'ready',
      'reload navigation',
    );
    recordSurface();
    observer.disconnect();
    unsubscribe();
    window.__workspaceDockInteraction.browserInteraction = {
      afterBack,
      afterForward,
      beforeBack,
      controls,
      documentCanvas: {
        hostBackground: getComputedStyle(node).backgroundColor,
      },
      events,
      firstUrl,
      reloadUrl: frame.getURL(),
      secondUrl,
      submission,
      surfaceStates,
    };
  })()`);
    const browserOwner = await evaluate<{ threadId: string; tabId: string }>(
      `(() => { const frame=document.querySelector('.browser-frame'); return {threadId:frame.dataset.browserThread,tabId:frame.dataset.browserTab}; })()`,
    );
    if (!browsers) throw new Error("Browser registry is unavailable");
    const browserContents = browsers.get(
      browserOwner.threadId,
      browserOwner.tabId,
    ).window.webContents;
    const documentCanvas = await browserContents.executeJavaScript(
      "(() => { const html=getComputedStyle(document.documentElement),body=getComputedStyle(document.body);return {bodyBackground:body.backgroundColor,bodyColor:body.color,htmlBackground:html.backgroundColor,text:document.body.textContent?.trim()??''}; })()",
    );
    await evaluate(
      `Object.assign(window.__workspaceDockInteraction.browserInteraction.documentCanvas, ${JSON.stringify(documentCanvas)})`,
    );
  } finally {
    browserServer.close();
  }

  if (
    resizePoint.layout === "resizable" &&
    resizePoint.x !== null &&
    resizePoint.y !== null
  ) {
    const inputScale = contents.getZoomFactor();
    const inputPoint = {
      x: Math.round(resizePoint.x * inputScale),
      y: Math.round(resizePoint.y * inputScale),
    };
    contents.sendInputEvent({ type: "mouseMove", ...inputPoint });
    contents.sendInputEvent({
      type: "mouseDown",
      button: "left",
      clickCount: 1,
      ...inputPoint,
    });
    await wait(80);
    contents.sendInputEvent({
      type: "mouseMove",
      x:
        inputPoint.x +
        (resizePoint.direction === "rtl" ? 1 : -1) *
          Math.round(96 * inputScale),
      y: inputPoint.y,
    });
    await wait(160);
    const releasePoint = await evaluate<{ x: number; y: number }>(`(() => {
      const resizer = document.querySelector(
        '[data-artemis-component="workspace-dock-resizer"]',
      );
      const bounds = resizer?.getBoundingClientRect();
      if (!bounds) throw new Error('Workspace Dock resizer disappeared.');
      return {
        x: Math.round(bounds.left + bounds.width / 2),
        y: Math.round(bounds.top + bounds.height / 2),
      };
    })()`);
    contents.sendInputEvent({
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      x: Math.round(releasePoint.x * inputScale),
      y: Math.round(releasePoint.y * inputScale),
    });
    await evaluate(`window.__workspaceDockWaitForLayout('open')`);
    await evaluate(`window.__workspaceDockInteraction.mouse =
      window.__workspaceDockCapture();
      window.__workspaceDockInteraction.pointerProbe =
        window.__workspaceDockPointerProbe`);

    await evaluate(`document
      .querySelector('[data-artemis-component="workspace-dock-resizer"]')
      ?.focus()`);
    await pressKey(
      resizePoint.direction === "rtl" ? "ArrowLeft" : "ArrowRight",
    );
    await evaluate(`window.__workspaceDockInteraction.arrow =
      window.__workspaceDockCapture()`);
    await pressKey("Home");
    await evaluate(`window.__workspaceDockInteraction.home =
      window.__workspaceDockCapture()`);
    await pressKey("End");
    await evaluate(`window.__workspaceDockInteraction.end =
      window.__workspaceDockCapture()`);
  } else {
    await evaluate(`Object.assign(window.__workspaceDockInteraction, {
      arrow: null,
      end: null,
      home: null,
      mouse: null,
      pointerProbe: null,
    })`);
  }

  await evaluate(`document.querySelector('.right-sidebar-toggle')?.click()`);
  await evaluate(`window.__workspaceDockWaitForLayout('closed')`);
  await evaluate(`window.__workspaceDockInteraction.closed =
    window.__workspaceDockCapture()`);
  await evaluate(`document.querySelector('.right-sidebar-toggle')?.click()`);
  await evaluate(`window.__workspaceDockWaitForLayout('open')`);
  await evaluate(`window.__workspaceDockInteraction.reopened =
    window.__workspaceDockCapture()`);
}

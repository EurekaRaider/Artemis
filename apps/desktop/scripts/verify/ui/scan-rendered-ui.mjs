export async function scan(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!element.checkVisibility({ visibilityProperty: true })) return false;
      const box = element.getBoundingClientRect();
      let left = Math.max(0, box.left),
        right = Math.min(innerWidth, box.right);
      let top = Math.max(0, box.top),
        bottom = Math.min(innerHeight, box.bottom);
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          style.opacity === "0" ||
          style.clipPath === "inset(50%)" ||
          style.clip === "rect(0px, 0px, 0px, 0px)"
        )
          return false;
        if (node === element) continue;
        const rect = node.getBoundingClientRect();
        if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
          left = Math.max(left, rect.left);
          right = Math.min(right, rect.right);
        }
        if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
          top = Math.max(top, rect.top);
          bottom = Math.min(bottom, rect.bottom);
        }
      }
      return right > left && bottom > top;
    };
    const identity = (element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const path = [];
      for (
        let node = element;
        node && node !== document.body;
        node = node.parentElement
      ) {
        const siblings = [...(node.parentElement?.children ?? [])].filter(
          (sibling) => sibling.tagName === node.tagName,
        );
        path.unshift(
          `${node.tagName.toLowerCase()}${[...node.classList].map((name) => `.${CSS.escape(name)}`).join("")}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ""}`,
        );
        if (node.parentElement?.id) {
          path.unshift(`#${CSS.escape(node.parentElement.id)}`);
          break;
        }
      }
      return path.join(" > ");
    };
    const nodes = [...document.body.querySelectorAll("*")].filter(
      (element) =>
        !(element instanceof SVGElement) &&
        !element.closest("svg, script, style") &&
        visible(element),
    );
    const violations = [];
    const metrics = nodes.map((element) => {
      const style = getComputedStyle(element),
        rect = element.getBoundingClientRect();
      const leaf =
        element.querySelector("strong, [data-part=label]") ?? element;
      const leafStyle = getComputedStyle(leaf);
      const textRange = document.createRange();
      textRange.selectNodeContents(leaf);
      const textRects = [...textRange.getClientRects()].map((rect) =>
        rect.toJSON(),
      );
      const metric = {
        selector: identity(element),
        ancestors: (() => {
          const parents = [];
          for (
            let parent = element.parentElement;
            parent && parent !== document.body;
            parent = parent.parentElement
          )
            parents.push(identity(parent));
          return parents;
        })(),
        tag: element.tagName.toLowerCase(),
        classes: element.className,
        component: element.dataset.artemisComponent,
        part: element.dataset.part,
        role: element.getAttribute("role"),
        variant: element.dataset.variant,
        sizeVariant: element.dataset.size,
        text: element.textContent.trim().slice(0, 160),
        placeholder: element.getAttribute("placeholder"),
        inputValue:
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
            ? element.value
            : undefined,
        placeholderStyle: element.hasAttribute("placeholder")
          ? (() => {
              const s = getComputedStyle(element, "::placeholder");
              return {
                font: s.fontFamily,
                size: s.fontSize,
                weight: s.fontWeight,
                lineHeight: s.lineHeight,
                color: s.color,
                opacity: s.opacity,
              };
            })()
          : undefined,
        directText: [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join("")
          .trim(),
        directTextRects: [...element.childNodes]
          .filter(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          )
          .flatMap((node) => {
            const range = document.createRange();
            range.selectNode(node);
            return [...range.getClientRects()].map((rect) => rect.toJSON());
          }),
        rect: rect.toJSON(),
        textRects,
        font: style.fontFamily,
        size: style.fontSize,
        weight: style.fontWeight,
        labelWeight: leafStyle.fontWeight,
        lineHeight: style.lineHeight,
        color: style.color,
        background: style.backgroundColor,
        border: style.borderTopWidth,
        borderColor: style.borderTopColor,
        radius: style.borderRadius,
        gap: style.gap,
        padding: style.padding,
        margin: style.margin,
        transform: style.textTransform,
        opacity: style.opacity,
        textOverflow: style.textOverflow,
        contentWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        icons: [...element.querySelectorAll("svg")]
          .filter(
            (icon) =>
              visible(icon) &&
              (icon.parentElement === element ||
                icon.closest("button, [role=option], [role=menuitem]") ===
                  element),
          )
          .map((icon) => ({
            name: icon.dataset.artemisIcon,
            viewBox: icon.getAttribute("viewBox"),
            strokeWidth: getComputedStyle(icon).strokeWidth,
            shapes: [
              ...icon.querySelectorAll(
                "path, circle, rect, line, polyline, polygon, ellipse",
              ),
            ].map((shape) => ({
              tag: shape.tagName,
              attributes: Object.fromEntries(
                [...shape.attributes]
                  .filter((attribute) => attribute.name !== "class")
                  .map((attribute) => [attribute.name, attribute.value]),
              ),
              fill: getComputedStyle(shape).fill,
              stroke: getComputedStyle(shape).stroke,
              strokeWidth: getComputedStyle(shape).strokeWidth,
              opacity: getComputedStyle(shape).opacity,
            })),
            rect: icon.getBoundingClientRect().toJSON(),
            color: getComputedStyle(icon).color,
            paths: [...icon.querySelectorAll("path")].map((path) =>
              path.getAttribute("d"),
            ),
          })),
        state: element.matches(":disabled")
          ? "disabled"
          : element.matches(
                "[aria-selected=true], [aria-checked=true], [aria-pressed=true], :checked, .selected, .active",
              )
            ? "selected"
            : "default",
      };
      const fail = (rule, actual, expected) =>
        violations.push({
          rule,
          selector: metric.selector,
          text: metric.text,
          actual,
          expected,
        });
      for (const icon of element.querySelectorAll("svg[data-artemis-icon]")) {
        if (icon.parentElement !== element) continue;
        const expected =
          icon.dataset.artemisIcon === "send" && icon.closest(".send-button")
            ? 2
            : 1.6;
        const actual = Number.parseFloat(getComputedStyle(icon).strokeWidth);
        if (Math.abs(actual - expected) > 0.01)
          fail(
            "B7",
            { icon: icon.dataset.artemisIcon, strokeWidth: actual },
            { strokeWidth: expected },
          );
      }
      if (
        element.matches(".composer") &&
        element.closest(".conversation")?.dataset.state !== "empty" &&
        innerWidth === 1440 &&
        rect.width > 701
      )
        fail(
          "B13",
          rect.width,
          "nonempty conversation Composer ≤700px at 1440px viewport",
        );
      if (
        element.matches(
          '[data-artemis-component="segmented-control"] [data-part="segment"]',
        )
      ) {
        const fileMode = Boolean(element.closest(".workspace-files-panel"));
        const height = fileMode ? 22 : 26;
        // Dock.dc.html's file view buttons explicitly use 11.5px at 22px high.
        const size = fileMode ? "11.5px" : "12.5px";
        const lineHeight = fileMode ? "17.25px" : "18.75px";
        if (
          Math.abs(rect.height - height) > 1 ||
          style.fontSize !== size ||
          style.fontWeight !== "500" ||
          style.lineHeight !== lineHeight ||
          style.borderRadius !== "7px" ||
          style.columnGap !== "6px" ||
          style.whiteSpace !== "nowrap"
        )
          fail(
            "B13",
            {
              height: rect.height,
              size: style.fontSize,
              weight: style.fontWeight,
              lineHeight: style.lineHeight,
              radius: style.borderRadius,
              gap: style.columnGap,
              whiteSpace: style.whiteSpace,
            },
            {
              height,
              size,
              weight: "500",
              lineHeight,
              radius: "7px",
              gap: "6px",
              whiteSpace: "nowrap",
            },
          );
      }
      if (
        element.matches(
          ".model-picker-options > button, .approval-policy-menu button, .slash-command-suggestion, [role=menuitem], .provider-navigation-name",
        ) &&
        leafStyle.fontWeight !== "400"
      )
        fail("B6", leafStyle.fontWeight, "400");
      if (
        element.matches(
          "[role=menuitem], [role=option], .composer-icon-button, .environment-header-action",
        ) &&
        element.querySelector("linearGradient")
      )
        fail("B7", "gradient", "monochrome");
      if (
        /^zh/.test(document.documentElement.lang) &&
        style.textTransform === "uppercase" &&
        metric.text
      )
        fail("B8", style.textTransform, "none");
      if (
        style.textOverflow === "ellipsis" &&
        element.scrollWidth > element.clientWidth + 1 &&
        /\S…\S/.test(metric.text) &&
        !element.children.length
      )
        fail("B9", metric.text, "one truncation");
      if (
        element.matches(
          ".review-line, .goal-bar-objective, .environment-upstream",
        ) &&
        element.matches(".review-line, .environment-upstream") &&
        !style.fontFamily.includes("Geist Mono")
      )
        fail("B12", style.fontFamily, "Geist Mono");
      if (
        element.matches(
          'code, kbd, .mono, .model-picker-id, .environment-upstream, .composer-project-path, .automation-time, .workspace-files-panel [data-part="path"] > span:first-child, .office-file-info > strong',
        ) &&
        !style.fontFamily.includes("Geist Mono")
      )
        fail("B12", style.fontFamily, "Geist Mono");
      if (
        element.matches(
          '[data-artemis-component="select"] [data-part="trigger"]',
        )
      ) {
        if (Math.abs(rect.height - 30) > 1)
          fail("B13", rect.height, "30px select trigger");
        if (
          style.fontSize !== "12.5px" ||
          style.fontWeight !== "400" ||
          style.lineHeight !== "18.75px"
        )
          fail(
            "B13",
            {
              size: style.fontSize,
              weight: style.fontWeight,
              lineHeight: style.lineHeight,
            },
            { size: "12.5px", weight: "400", lineHeight: "18.75px" },
          );
        const indicator = element.querySelector('[data-part="indicator"] svg');
        if (indicator) {
          const box = indicator.getBoundingClientRect();
          if (
            Math.abs(box.width - 14) > 0.01 ||
            Math.abs(box.height - 14) > 0.01
          )
            fail(
              "B7",
              { width: box.width, height: box.height },
              "14×14px select chevron",
            );
        }
      }
      if (
        element.matches(".goal-bar-status") &&
        (style.fontSize !== "11.5px" || style.lineHeight !== "17.25px")
      )
        fail(
          "B13",
          { size: style.fontSize, lineHeight: style.lineHeight },
          { size: "11.5px", lineHeight: "17.25px" },
        );
      if (
        element.matches('.thinking-level-control [data-part="segment"]') &&
        (Math.abs(rect.height - 26) > 1 || style.whiteSpace !== "nowrap")
      )
        fail(
          "B13",
          { height: rect.height, whiteSpace: style.whiteSpace },
          { height: 26, whiteSpace: "nowrap" },
        );
      if (
        element.matches(".decision-option-number, kbd") &&
        Math.abs(rect.height - 18) > 1
      )
        fail("B13", rect.height, "18px keyboard cap");
      if (
        element.matches("[data-artemis-component=button]") &&
        element.dataset.size !== "custom" &&
        !element.closest(".segmented-control, .thinking-level-control")
      ) {
        // A public Button can implement a menu row or navigation card. Bind
        // its visual role to the board rather than assuming its API density
        // describes that role. Composer tall rows are >=40; Settings .pv is
        // 40; Automations detail actions and Overlays capsule actions are 30.
        const tall = element.matches(
          ".slash-command-suggestion, .settings-import-shortcut, .automation-master-row > button",
        );
        const standard = element.matches(
          ".automation-actions button, .settings-profile-avatar-actions button, .settings-section > header button, .settings-update-actions button, .computer-control-actions button",
        );
        const dataRow = element.matches(".token-usage-model-bars button");
        const budget = element.matches(".goal-bar-actions > button");
        const expected = element.matches(
          ".provider-navigation-item, .provider-add-service",
        )
          ? 40
          : budget
            ? 24
            : standard
              ? 30
              : element.dataset.size === "compact"
                ? 26
                : 30;
        metric.designVariant = tall
          ? "mi.tall (minimum 40px; wrapping allowed)"
          : `${expected}px control`;
        if (tall ? rect.height < 39 : Math.abs(rect.height - expected) > 1)
          fail(
            "B13",
            rect.height,
            tall ? ">=40px tall row" : `${expected}px button`,
          );
        if (dataRow) {
          if (style.fontSize !== "13px" || style.fontWeight !== "400")
            fail(
              "B13",
              { size: style.fontSize, weight: style.fontWeight },
              { size: "13px", weight: "400" },
            );
        } else if (
          !tall &&
          !element.className &&
          element.closest(".app-shell")
        ) {
          const fontSize = expected <= 26 ? "12px" : "12.5px";
          if (
            style.fontSize !== fontSize ||
            style.fontWeight !== "500" ||
            style.columnGap !== "6px"
          )
            fail(
              "B13",
              {
                size: style.fontSize,
                weight: style.fontWeight,
                gap: style.columnGap,
              },
              { size: fontSize, weight: "500", gap: "6px" },
            );
        }
      }
      if (
        element.matches('.archive-select [data-part="indicator"]') &&
        (Math.abs(rect.width - 16) > 1 ||
          Math.abs(rect.height - 16) > 1 ||
          style.borderRadius !== "4px")
      )
        fail(
          "B13",
          {
            width: rect.width,
            height: rect.height,
            radius: style.borderRadius,
          },
          "16×16px / 4px",
        );
      if (
        element.matches(".approval-policy-menu") &&
        element.querySelector(".approval-policy-heading")
      )
        fail(
          "B11",
          "visible menu heading",
          "no heading; accessible name retained",
        );
      if (
        element.matches(".review-line code") &&
        element.closest(".review-markdown-diff, .review-text-diff")
      ) {
        const token = getComputedStyle(document.querySelector(".app-shell"))
          .getPropertyValue("--text")
          .trim();
        const probe = document.createElement("span");
        probe.style.color = token;
        element.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        if (style.color !== expected) fail("B10", style.color, expected);
      }
      if (
        element.matches(
          ".resource-mcp-chips [data-mode], .resource-mcp-local [data-mode], .resource-mcp-remote [data-mode]",
        )
      ) {
        if (Math.abs(rect.height - 22) > 1) fail("B13", rect.height, 22);
        if (style.columnGap !== "6px") fail("B13", style.columnGap, "6px");
      }
      if (element.matches('.tool-card > [data-part="disclosure"]')) {
        const parent = element.parentElement.getBoundingClientRect();
        if (Math.abs(rect.height - 30) > 1 || rect.width > parent.width + 1)
          fail(
            "B1",
            rect.toJSON(),
            "tool disclosure stays within its 30px row",
          );
      }
      return metric;
    });
    const noticePositions = [...document.querySelectorAll(".transient-notice")]
      .filter(visible)
      .map((notice) => {
        const rect = notice.getBoundingClientRect(),
          workspace = notice.closest(".workspace").getBoundingClientRect();
        const composer = notice.closest(".composer-wrap");
        const target =
          composer?.querySelector(".composer") ??
          document.querySelector(".archived-readonly, .im-retired-notice");
        const targetRect = target?.getBoundingClientRect();
        const record = {
          selector: identity(notice),
          rect: rect.toJSON(),
          placement: notice.classList.contains("view-notice")
            ? "management bottom"
            : "above Composer/read-only footer",
          target: targetRect?.toJSON(),
        };
        if (notice.classList.contains("view-notice")) {
          if (Math.abs(workspace.bottom - rect.bottom - 24) > 1)
            violations.push({
              rule: "B5",
              selector: record.selector,
              actual: workspace.bottom - rect.bottom,
              expected: "management notice 24px from bottom",
            });
        } else {
          if (!composer || !targetRect || rect.bottom > targetRect.top)
            violations.push({
              rule: "B5",
              selector: record.selector,
              actual: record,
              expected: "notification anchored above Composer/read-only footer",
            });
          if (
            targetRect &&
            (Math.abs(rect.left - targetRect.left) > 1 ||
              Math.abs(rect.width - targetRect.width) > 1)
          )
            violations.push({
              rule: "B1",
              selector: record.selector,
              actual: record,
              expected:
                "notice matches visible Composer/read-only footer width and edges",
            });
          if (targetRect && Math.abs(targetRect.top - rect.bottom - 10) > 1)
            violations.push({
              rule: "B4",
              selector: record.selector,
              actual: targetRect.top - rect.bottom,
              expected: "10px gap above Composer/read-only footer",
            });
        }
        return record;
      });
    const messageActionGaps = [
      ...document.querySelectorAll(
        '.assistant-message > [data-part="actions"]',
      ),
    ]
      .filter(visible)
      .flatMap((actions) => {
        const next = actions.parentElement.nextElementSibling;
        if (!next || !visible(next)) return [];
        const actionRect = actions.getBoundingClientRect(),
          nextRect = next.getBoundingClientRect();
        const gap = nextRect.top - actionRect.bottom;
        if (
          gap < 0 &&
          actionRect.left < nextRect.right &&
          actionRect.right > nextRect.left
        )
          violations.push({
            rule: "B1",
            selector: identity(actions),
            actual: gap,
            expected: "message actions do not overlap the following activity",
          });
        return [
          {
            selector: identity(actions),
            next: identity(next),
            actions: actionRect.toJSON(),
            following: nextRect.toJSON(),
            gap,
          },
        ];
      });
    const menus = [
      ...document.querySelectorAll(
        '.model-picker-menu, .approval-policy-menu, .environment-workspace-menu, .branch-context-menu, .project-context-menu, .slash-command-menu, [data-artemis-component="select"] [data-part="menu"]',
      ),
    ]
      .filter(visible)
      .map((menu) => {
        const select = menu.closest('[data-artemis-component="select"]');
        const trigger = select
          ? select.querySelector('[data-part="trigger"]')
          : menu.matches(".slash-command-menu")
            ? menu.closest(".composer")
            : menu.matches(".model-picker-menu")
              ? document.querySelector(".model-button")
              : menu.matches(".approval-policy-menu")
                ? document.querySelector(".approval-policy-trigger")
                : menu.matches(".project-context-menu")
                  ? document.querySelector(
                      ".project-context-trigger[aria-expanded=true]",
                    )
                  : document.querySelector(
                      ".environment-workspace-trigger[aria-expanded=true], .branch-context-trigger[aria-expanded=true]",
                    );
        if (!trigger) {
          violations.push({
            rule: "B5",
            selector: identity(menu),
            actual: "missing trigger",
            expected: "measured visible trigger",
          });
          return { selector: identity(menu), missingTrigger: true };
        }
        const actual = menu.getBoundingClientRect(),
          anchor = trigger.getBoundingClientRect(),
          rtl = document.documentElement.dir === "rtl";
        const edgeDelta = Math.abs(
          rtl ? actual.right - anchor.right : actual.left - anchor.left,
        );
        const container =
          (menu.matches(".project-context-menu")
            ? trigger.closest(".conversation")?.querySelector(".composer")
            : trigger.closest(".composer")
          )?.getBoundingClientRect() ?? anchor;
        const overlap =
          Math.min(actual.bottom, container.bottom) -
          Math.max(actual.top, container.top);
        if (
          actual.left < -1 ||
          actual.right > innerWidth + 1 ||
          actual.top < -1 ||
          actual.bottom > innerHeight + 1
        )
          violations.push({
            rule: "B5",
            selector: identity(menu),
            actual: actual.toJSON(),
            expected: "inside viewport",
          });
        if (edgeDelta > 1)
          violations.push({
            rule: "B5",
            selector: identity(menu),
            actual: edgeDelta,
            expected: "anchor edge ±1px",
          });
        if (overlap > 1)
          violations.push({
            rule: "B5",
            selector: identity(menu),
            actual: overlap,
            expected: "no overlap with trigger container",
          });
        if (select || menu.matches(".slash-command-menu")) {
          const gap = select
            ? actual.top - anchor.bottom
            : anchor.top - actual.bottom;
          if (Math.abs(gap - 10) > 1)
            violations.push({
              rule: "B5",
              selector: identity(menu),
              actual: gap,
              expected: select ? "10px below Select" : "10px above Composer",
            });
        }
        return {
          selector: identity(menu),
          rect: actual.toJSON(),
          trigger: anchor.toJSON(),
          edgeDelta,
          overlap,
        };
      });
    const adjacentGaps = [];
    for (const parent of document.querySelectorAll(
      ".decision-body, .question-decision, .multi-question, .model-picker-thinking, .slash-command-suggestion, .archive-batch-bar, .welcome-resume-grid, .token-usage-summary",
    )) {
      if (!visible(parent)) continue;
      const children = [...parent.children].filter(visible),
        style = getComputedStyle(parent);
      for (let index = 1; index < children.length; index++) {
        const before = children[index - 1],
          after = children[index],
          a = before.getBoundingClientRect(),
          b = after.getBoundingClientRect();
        const vertical =
          style.flexDirection === "column" ||
          (style.display !== "flex" && b.top >= a.bottom);
        const gap = vertical
          ? b.top - a.bottom
          : document.documentElement.dir === "rtl"
            ? a.left - b.right
            : b.left - a.right;
        const expected = parent.matches(".decision-body")
          ? 10
          : parent.matches(".model-picker-thinking")
            ? 8
            : parent.matches(".archive-batch-bar")
              ? 10
              : null;
        adjacentGaps.push({
          parent: identity(parent),
          before: identity(before),
          after: identity(after),
          gap,
          expected,
          beforeMargin: getComputedStyle(before).margin,
          afterMargin: getComputedStyle(after).margin,
        });
        if (expected !== null && Math.abs(gap - expected) > 1)
          violations.push({
            rule: "B4",
            selector: identity(parent),
            actual: gap,
            expected,
          });
      }
    }
    const tokens = {};
    const surface = document.querySelector(".app-shell") ?? document.body;
    const surfaceStyle = getComputedStyle(surface);
    for (const name of [
      "--text",
      "--muted",
      "--muted-2",
      "--main",
      "--panel",
      "--success",
      "--danger",
      "--accent",
      "--gold",
      "--border",
      "--tx",
      "--tx2",
      "--tx3",
      "--s1",
      "--s2",
      "--s3",
      "--ok",
      "--bad",
    ])
      tokens[name] = surfaceStyle.getPropertyValue(name).trim();
    return {
      metrics,
      menus,
      messageActionGaps,
      noticePositions,
      adjacentGaps,
      tokens,
      violations,
      states: [...new Set(metrics.map((node) => node.state))],
      coverage: {
        B1: "Unique selectors, visible control rectangles, inner text range rectangles and icon rectangles are recorded independently.",
        B2: "Default/selected/disabled actual states are recorded; the driver records real hover states. Cross-fixture state coverage is checked in the board ledger.",
        B3: "Actual semantic state colors are recorded; PR open/merged/draft/closed are compared across fixtures.",
        B4: "Adjacent painted-control gaps and both margins are recorded; bound decision/model/batch contracts are asserted; other gaps require board comparison.",
        B5: "Menu anchors, direction, viewport and composer overlap are measured.",
        B6: "Visible menu and option weights are checked against 400.",
        B7: "Menu/toolbar gradients are rejected; icon paths and sizes are recorded for board comparison.",
        B8: "Visible uppercase in Chinese is rejected; all locale values have a separate contract test.",
        B9: "Overflow and ellipsis metrics are recorded; simultaneous middle and CSS truncation is rejected.",
        B10: "Semantic colors and diff text colors are recorded/checked; token meaning requires board comparison.",
        B11: "Visible element sets are recorded; prohibited heading/close controls have fixture assertions; other extras require board comparison and A references.",
        B12: "Code, keyboard caps, explicit mono, branch and schedule fonts are checked.",
        B13: "Public buttons, keyboard caps and MCP pills have computed-size checks; per-board overrides are compared in the ledger.",
        B14: "Theme, locale and direction are recorded; the driver requires the full three-variant matrix.",
        B15: "The driver checks its complete fixture manifest; absent product capabilities are separately identified, never silently passed.",
      },
      theme: document.documentElement.dataset.theme ?? surface.dataset.theme,
      locale: document.documentElement.lang,
      direction: document.documentElement.dir,
      rules: [
        "B1",
        "B2",
        "B3",
        "B4",
        "B5",
        "B6",
        "B7",
        "B8",
        "B9",
        "B10",
        "B11",
        "B12",
        "B13",
        "B14",
        "B15",
      ],
    };
  });
}

/* Artemis UI 0.1.0. Browser-only, no dependencies, works from file://. */
(function (global) {
  "use strict";
  const instances = new WeakMap();
  const layers = [];
  let sequence = 0;
  const enabled = (el) =>
    !el.disabled && el.getAttribute("aria-disabled") !== "true";
  const visible = (el) =>
    !el.hidden && !el.closest("[inert]") && el.getClientRects().length > 0;
  const focusable = (root) =>
    Array.from(
      root.querySelectorAll("button,input,select,textarea,a[href],[tabindex]"),
    ).filter((el) => enabled(el) && el.tabIndex >= 0 && visible(el));
  function identity(el) {
    if (!el.id) {
      do {
        el.id = "artemis-ui-" + ++sequence;
      } while (el.ownerDocument.querySelectorAll("#" + el.id).length > 1);
    }
    return el.id;
  }
  function lifecycle(root, type, setup) {
    let entries = instances.get(root);
    if (!entries) {
      entries = new Map();
      instances.set(root, entries);
    }
    if (entries.has(type)) return entries.get(type);
    const abort = new AbortController(),
      cleanups = [];
    const on = (el, event, handler, options) =>
      el.addEventListener(event, handler, { ...options, signal: abort.signal });
    const api = setup(on, (fn) => cleanups.push(fn));
    let disposed = false;
    const destroy = api.destroy;
    api.destroy = () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      if (destroy) destroy();
      cleanups.reverse().forEach((fn) => fn());
      entries.delete(type);
    };
    entries.set(type, api);
    return api;
  }
  function button({
    label = "",
    variant = "secondary",
    size,
    icon,
    iconOnly = false,
    disabled = false,
    className = "",
  } = {}) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "ui-button " + className;
    el.dataset.variant = variant;
    if (size) el.dataset.size = size;
    el.disabled = disabled;
    if (icon) el.append(icon.cloneNode(true));
    if (iconOnly) {
      el.dataset.iconOnly = "";
      el.setAttribute("aria-label", label);
    } else el.append(document.createTextNode(label));
    return el;
  }
  function tab({
    label,
    value,
    className = "",
    closeClass = "ui-tab-close",
    closable = true,
    icon,
  } = {}) {
    const el = button({ label, icon, className: "ui-tab " + className });
    el.classList.remove("ui-button");
    el.removeAttribute("data-variant");
    el.setAttribute("role", "tab");
    el.dataset.value = value || label;
    el.setAttribute("aria-selected", "false");
    el.tabIndex = -1;
    if (closable) {
      const close = document.createElement("span");
      close.className = "ui-tab-close " + closeClass;
      close.textContent = "×";
      close.setAttribute("aria-hidden", "true");
      el.append(close);
    }
    return el;
  }
  function floating(trigger, panel, options = {}) {
    return lifecycle(panel, "floating", (on, cleanup) => {
      const doc = panel.ownerDocument;
      let opened = false,
        api;
      panel.classList.add("ui-floating");
      trigger.setAttribute("aria-controls", identity(panel));
      const hide = options.hidden === true;
      function removeLayer() {
        const index = layers.indexOf(api);
        if (index >= 0) layers.splice(index, 1);
      }
      function setOpen(value, { focus = false, restore = false } = {}) {
        if (value && !enabled(trigger)) return;
        opened = Boolean(value);
        panel.classList.toggle("open", opened);
        panel.inert = !opened;
        panel.setAttribute("aria-hidden", String(!opened));
        trigger.setAttribute("aria-expanded", String(opened));
        if (hide) panel.hidden = !opened;
        removeLayer();
        if (opened) layers.push(api);
        if (options.onOpenChange) options.onOpenChange(opened);
        if (opened && focus) (focusable(panel)[0] || panel).focus();
        if (!opened && restore && trigger.isConnected) trigger.focus();
      }
      api = {
        setOpen,
        open: (opts) => setOpen(true, opts),
        close: (opts) => setOpen(false, opts),
        get isOpen() {
          return opened;
        },
        destroy() {
          setOpen(false);
          removeLayer();
        },
      };
      on(trigger, "click", () =>
        setOpen(!opened, { focus: options.focusOnOpen === true }),
      );
      on(doc, "click", (e) => {
        if (
          opened &&
          layers[layers.length - 1] === api &&
          !trigger.contains(e.target) &&
          !panel.contains(e.target)
        )
          setOpen(false);
      });
      on(doc, "keydown", (e) => {
        if (
          e.key !== "Escape" ||
          e.defaultPrevented ||
          layers[layers.length - 1] !== api ||
          !opened
        )
          return;
        if (doc.querySelector("dialog[open]") && !panel.closest("dialog[open]"))
          return;
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false, { restore: true });
      });
      on(panel, "focusout", (e) => {
        queueMicrotask(() => {
          if (
            opened &&
            layers.at(-1) === api &&
            !doc.querySelector("dialog[open]") &&
            e.relatedTarget &&
            !panel.contains(e.relatedTarget) &&
            !trigger.contains(e.relatedTarget)
          )
            setOpen(false);
        });
      });
      cleanup(removeLayer);
      setOpen(false);
      return api;
    });
  }
  function menu(trigger, panel, options = {}) {
    return lifecycle(panel, "menu", (on, cleanup) => {
      const selector =
        options.selector || '[role="option"], [role="menuitem"], button';
      const items = () =>
        Array.from(panel.querySelectorAll(selector)).filter(enabled);
      const listbox = options.select !== false;
      if (listbox && options.selectedClass)
        items().forEach((el) =>
          el.setAttribute(
            "aria-selected",
            String(el.classList.contains(options.selectedClass)),
          ),
        );
      panel.setAttribute("role", listbox ? "listbox" : "menu");
      trigger.setAttribute("aria-haspopup", listbox ? "listbox" : "menu");
      function focusItem(item) {
        items().forEach((el) => {
          el.tabIndex = el === item ? 0 : -1;
        });
        item?.focus();
      }
      const pop = floating(trigger, panel, {
        ...options,
        focusOnOpen: false,
        onOpenChange(open) {
          items().forEach((el) => {
            el.tabIndex = -1;
            el.classList.add("ui-menu-item");
            el.setAttribute("role", listbox ? "option" : "menuitem");
          });
          if (options.onOpenChange) options.onOpenChange(open);
          if (open)
            focusItem(
              items().find(
                (el) => el.getAttribute("aria-selected") === "true",
              ) || items()[0],
            );
        },
      });
      cleanup(() => pop.destroy());
      function select(item, notify = true) {
        if (!item || !items().includes(item)) return;
        if (listbox)
          items().forEach((el) => {
            const selected = el === item;
            el.setAttribute("aria-selected", String(selected));
            if (options.selectedClass)
              el.classList.toggle(options.selectedClass, selected);
          });
        if (notify && options.onSelect) options.onSelect(item);
        pop.close({ restore: notify });
      }
      on(panel, "click", (e) => {
        const item = e.target.closest(selector);
        if (item && panel.contains(item)) select(item);
      });
      on(trigger, "keydown", (e) => {
        if (["ArrowDown", "ArrowUp"].includes(e.key)) {
          e.preventDefault();
          pop.open();
          if (e.key === "ArrowUp") focusItem(items().at(-1));
        }
      });
      let query = "",
        queryTimer;
      on(panel, "keydown", (e) => {
        const list = items(),
          at = list.indexOf(panel.ownerDocument.activeElement);
        if (!list.length) return;
        const next =
          e.key === "ArrowDown"
            ? (at + 1) % list.length
            : e.key === "ArrowUp"
              ? (at - 1 + list.length) % list.length
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? list.length - 1
                  : -1;
        if (next >= 0) {
          e.preventDefault();
          focusItem(list[next]);
        } else if (["Enter", " "].includes(e.key)) {
          e.preventDefault();
          select(list[at]);
        } else if (
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          query += e.key.toLocaleLowerCase();
          clearTimeout(queryTimer);
          queryTimer = setTimeout(() => {
            query = "";
          }, 600);
          const match = list.find((el) =>
            el.textContent.trim().toLocaleLowerCase().startsWith(query),
          );
          if (match) focusItem(match);
        }
      });
      cleanup(() => clearTimeout(queryTimer));
      return {
        select,
        open: pop.open,
        close: pop.close,
        get isOpen() {
          return pop.isOpen;
        },
      };
    });
  }
  function tabs(root, options = {}) {
    return lifecycle(root, "tabs", (on) => {
      const selector = options.selector || '[role="tab"]';
      root.classList.add("ui-tabs");
      root.setAttribute("role", "tablist");
      function list() {
        return Array.from(root.querySelectorAll(selector)).filter(enabled);
      }
      function select(current, focus = false, notify = true) {
        if (!list().includes(current)) return;
        list().forEach((el) => {
          const active = el === current;
          el.classList.add("ui-tab");
          el.setAttribute("role", "tab");
          el.setAttribute("aria-selected", String(active));
          el.tabIndex = active ? 0 : -1;
          el.classList.toggle("active", active);
          const panel = options.panelFor?.(el);
          if (panel) {
            el.setAttribute("aria-controls", identity(panel));
            panel.setAttribute("aria-labelledby", identity(el));
            panel.setAttribute("role", "tabpanel");
            panel.hidden = !active;
            panel.classList.toggle("show", active);
          }
        });
        if (focus) current.focus();
        if (notify) options.onSelect?.(current);
      }
      function refresh() {
        const items = list();
        const active =
          items.find(
            (el) =>
              el.getAttribute("aria-selected") === "true" ||
              el.classList.contains("active"),
          ) || items[0];
        if (active) select(active, false, false);
      }
      on(root, "click", (e) => {
        const current = e.target.closest(selector);
        if (!current || !root.contains(current)) return;
        if (options.closeSelector && e.target.closest(options.closeSelector)) {
          options.onClose?.(current);
          return;
        }
        select(current);
      });
      on(root, "keydown", (e) => {
        const items = list(),
          current = e.target.closest(selector),
          at = items.indexOf(current);
        if (at < 0) return;
        if (e.key === "Delete" && options.onClose) {
          e.preventDefault();
          options.onClose(current);
          return;
        }
        const vertical = options.orientation === "vertical";
        const next =
          e.key === (vertical ? "ArrowDown" : "ArrowRight")
            ? (at + 1) % items.length
            : e.key === (vertical ? "ArrowUp" : "ArrowLeft")
              ? (at - 1 + items.length) % items.length
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : -1;
        if (next >= 0) {
          e.preventDefault();
          select(items[next], true);
        }
      });
      if (options.orientation)
        root.setAttribute("aria-orientation", options.orientation);
      refresh();
      return { select, refresh };
    });
  }
  function dialog(panel, options = {}) {
    return lifecycle(panel, "dialog", (on, cleanup) => {
      const doc = panel.ownerDocument,
        surface = options.surface || panel;
      let previous,
        opened = false,
        inertValues = [],
        api;
      const native = panel.tagName === "DIALOG";
      surface.setAttribute("role", "dialog");
      surface.setAttribute("aria-modal", "true");
      function removeLayer() {
        const index = layers.indexOf(api);
        if (index >= 0) layers.splice(index, 1);
      }
      function close(restore = true) {
        if (!opened) return;
        opened = false;
        if (native && panel.open) panel.close();
        else panel.classList.remove("open");
        if (!native) panel.inert = true;
        inertValues.forEach(([el, value]) => {
          el.inert = value;
        });
        inertValues = [];
        removeLayer();
        if (restore && previous?.isConnected) previous.focus();
        options.onClose?.();
      }
      function open(trigger) {
        if (opened) return;
        previous = trigger || doc.activeElement;
        opened = true;
        panel.inert = false;
        inertValues = (options.inert || []).map((el) => [el, el.inert]);
        inertValues.forEach(([el]) => {
          el.inert = true;
        });
        if (native) {
          panel.returnValue = "";
          panel.showModal();
        } else panel.classList.add("open");
        layers.push(api);
        (options.initialFocus || focusable(surface)[0] || surface).focus();
      }
      api = {
        open,
        close,
        get isOpen() {
          return opened;
        },
        destroy() {
          close(false);
        },
      };
      on(panel, "click", (e) => {
        if (e.target === panel && options.dismissOutside !== false) close();
        if (e.target.closest("[data-close]")) close();
      });
      on(doc, "keydown", (e) => {
        if (!opened || layers.at(-1) !== api || e.defaultPrevented) return;
        if (doc.querySelector("dialog[open]") && !native) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          close();
        }
        if (e.key === "Tab") {
          const items = focusable(surface),
            first = items[0],
            last = items.at(-1);
          if (!first) {
            e.preventDefault();
            surface.tabIndex = -1;
            surface.focus();
          } else if (
            e.shiftKey &&
            (doc.activeElement === first ||
              !surface.contains(doc.activeElement))
          ) {
            e.preventDefault();
            last.focus();
          } else if (
            !e.shiftKey &&
            (doc.activeElement === last || !surface.contains(doc.activeElement))
          ) {
            e.preventDefault();
            first.focus();
          }
        }
      });
      if (native) {
        on(panel, "close", () => close());
        on(panel, "cancel", (e) => {
          e.preventDefault();
          close();
        });
      } else panel.inert = true;
      cleanup(removeLayer);
      return api;
    });
  }
  function splitPane(handle, options) {
    return lifecycle(handle, "splitPane", (on, cleanup) => {
      let value = options.initial,
        start,
        dragging = false;
      function set(next) {
        const limit = options.limits();
        value = Math.round(Math.min(limit.max, Math.max(limit.min, next)));
        handle.setAttribute("aria-valuemin", String(limit.min));
        handle.setAttribute("aria-valuemax", String(limit.max));
        handle.setAttribute("aria-valuenow", String(value));
        options.onChange(value, limit);
        return value;
      }
      function end() {
        dragging = false;
        handle.classList.remove("dragging");
        options.onDrag?.(false);
      }
      on(handle, "pointerdown", (e) => {
        if (!enabled(handle) || e.button !== 0) return;
        e.preventDefault();
        dragging = true;
        start = { x: e.clientX, value: options.getValue?.() ?? value };
        handle.classList.add("dragging");
        handle.setPointerCapture(e.pointerId);
        options.onDrag?.(true);
      });
      on(handle, "pointermove", (e) => {
        if (dragging)
          set(start.value + (e.clientX - start.x) * (options.direction || 1));
      });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach((event) =>
        on(handle, event, end),
      );
      on(handle, "dblclick", () => {
        if (enabled(handle)) set(options.reset?.() ?? options.initial);
      });
      on(handle, "keydown", (e) => {
        if (!enabled(handle)) return;
        const direction = options.direction || 1;
        const next =
          e.key === "Home"
            ? (options.home?.() ?? options.reset?.() ?? options.initial)
            : e.key === "End"
              ? options.limits().max
              : e.key === "ArrowLeft"
                ? value - (options.step || 24) * direction
                : e.key === "ArrowRight"
                  ? value + (options.step || 24) * direction
                  : null;
        if (next !== null) {
          e.preventDefault();
          set(next);
        }
      });
      cleanup(end);
      set(value);
      return { set };
    });
  }
  function disclosure(trigger, panel, options = {}) {
    return lifecycle(trigger, "disclosure", (on) => {
      function set(open) {
        trigger.setAttribute("aria-expanded", String(open));
        if (options.classTarget)
          options.classTarget.classList.toggle(
            options.className || "open",
            open,
          );
        else panel.hidden = !open;
        options.onChange?.(open);
      }
      on(trigger, "click", () =>
        set(trigger.getAttribute("aria-expanded") !== "true"),
      );
      if (panel) trigger.setAttribute("aria-controls", identity(panel));
      return { set };
    });
  }
  function autosize(input, max = 140) {
    return lifecycle(input, "autosize", (on) => {
      function update() {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, max) + "px";
      }
      on(input, "input", update);
      return { update };
    });
  }
  function toast(host, options = {}) {
    return lifecycle(host, "toast", (on, cleanup) => {
      let timer;
      function show(message, error = false) {
        clearTimeout(timer);
        host.textContent = message;
        host.setAttribute("role", error ? "alert" : "status");
        host.setAttribute("aria-live", error ? "assertive" : "polite");
        host.classList.toggle("error", error);
        host.classList.add("show");
        timer = setTimeout(
          () => host.classList.remove("show"),
          options.duration || 3000,
        );
      }
      cleanup(() => {
        clearTimeout(timer);
        host.classList.remove("show");
      });
      return { show };
    });
  }
  function enhance(root = document) {
    const find = (selector) => [
      ...(root.matches?.(selector) ? [root] : []),
      ...root.querySelectorAll(selector),
    ];
    find(".btn,.btn-lg,.btn-icon,.icon-btn").forEach((el) => {
      el.classList.add("ui-button");
      if (el.tagName === "BUTTON" && !el.hasAttribute("type"))
        el.type = "button";
      el.dataset.variant =
        el.classList.contains("btn-primary") || el.classList.contains("btn-lg")
          ? "primary"
          : el.classList.contains("btn-danger")
            ? "danger"
            : el.classList.contains("btn-ghost") ||
                el.classList.contains("btn-quiet") ||
                el.classList.contains("icon-btn") ||
                el.classList.contains("btn-icon")
              ? "ghost"
              : "secondary";
      if (el.classList.contains("danger")) el.dataset.tone = "danger";
      if (el.classList.contains("loading")) {
        el.disabled = true;
        el.setAttribute("aria-busy", "true");
      }
      if (
        el.classList.contains("icon-btn") ||
        el.classList.contains("btn-icon")
      )
        el.dataset.iconOnly = "";
    });
    find(".switch").forEach((el) => el.classList.add("ui-switch"));
    find(".dock-tab .x,.dock-tab .dt-x").forEach((el) =>
      el.classList.add("ui-tab-close"),
    );
    find(
      "input.input,textarea.textarea,select.select-pill,input.im-field-input,textarea.editor-area",
    ).forEach((el) => el.classList.add("ui-field"));
  }
  function toggle(control, options = {}) {
    return lifecycle(control, "toggle", (on) => {
      const input = control.matches("input")
        ? control
        : control.querySelector("input");
      function set(checked, notify = true) {
        if (input) input.checked = checked;
        control.classList.toggle("on", checked);
        if (!input) {
          control.setAttribute("role", "switch");
          control.setAttribute("aria-checked", String(checked));
        }
        if (notify) options.onChange?.(checked);
      }
      if (input) on(input, "change", () => set(input.checked));
      else
        on(control, "click", () => {
          if (enabled(control))
            set(control.getAttribute("aria-checked") !== "true");
        });
      set(
        input ? input.checked : control.getAttribute("aria-checked") === "true",
        false,
      );
      return { set };
    });
  }
  const api = {
    toggle,
    version: "0.1.0",
    button,
    tab,
    floating,
    menu,
    tabs,
    dialog,
    splitPane,
    disclosure,
    autosize,
    toast,
    enhance,
  };
  global.ArtemisUI = Object.freeze(api);
})(window);

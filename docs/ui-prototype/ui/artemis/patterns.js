/* Artemis display patterns. Data and persistence callbacks belong to the host page. */
(function (global) {
  "use strict";
  const mounted = new WeakMap();
  function mount(root, kind, setup) {
    let entries = mounted.get(root);
    if (!entries) {
      entries = new Map();
      mounted.set(root, entries);
    }
    if (entries.has(kind)) return entries.get(kind);
    const abort = new AbortController(),
      cleanup = [];
    const on = (node, type, fn, options) =>
      node.addEventListener(type, fn, { ...options, signal: abort.signal });
    const api = setup(on, (fn) => cleanup.push(fn));
    let disposed = false;
    api.destroy = () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      cleanup.forEach((fn) => fn());
      entries.delete(kind);
    };
    entries.set(kind, api);
    return api;
  }
  function goalEditor(
    root,
    {
      input,
      save,
      revert,
      status,
      onSave = (value) => value,
      onChange,
      labels = {},
    },
  ) {
    return mount(root, "goalEditor", (on, cleanup) => {
      let original = input.value,
        phase = "ready",
        disposed = false,
        revision = 0;
      const text = {
        saved: "已保存",
        dirty: "未保存更改",
        saving: "正在保存…",
        error: "保存失败，请重试",
        ...labels,
      };
      function render(message) {
        const dirty = input.value !== original,
          busy = phase === "saving" || phase === "loading";
        root.setAttribute("aria-busy", String(busy));
        input.disabled = busy;
        input.classList.toggle("dirty", dirty);
        save.disabled = busy || !dirty || !input.value.trim();
        revert.disabled = busy || !dirty;
        status.classList.toggle("error", phase === "error");
        status.textContent =
          message ||
          (busy
            ? text.saving
            : phase === "error"
              ? text.error
              : dirty
                ? text.dirty
                : text.saved);
        onChange?.({ value: input.value, dirty, phase });
      }
      async function commit() {
        if (save.disabled) return;
        const request = ++revision,
          value = input.value.trim();
        phase = "saving";
        render();
        try {
          const result = await onSave(value);
          if (disposed || request !== revision) return;
          original = typeof result === "string" ? result : value;
          input.value = original;
          phase = "ready";
          render();
        } catch (error) {
          if (disposed || request !== revision) return;
          phase = "error";
          render();
        }
      }
      function reset() {
        if (input.disabled) return;
        input.value = original;
        phase = "ready";
        render();
        input.focus();
      }
      on(input, "input", () => {
        phase = "ready";
        render();
      });
      on(input, "keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          commit();
        }
      });
      on(save, "click", commit);
      on(revert, "click", reset);
      cleanup(() => {
        disposed = true;
        revision++;
      });
      render();
      return {
        save: commit,
        revert: reset,
        setState(next, message) {
          revision++;
          phase = next;
          render(message);
        },
        get value() {
          return original;
        },
      };
    });
  }
  function taskPlan(
    root,
    {
      steps,
      index = 0,
      statuses = [],
      trigger,
      list,
      marker,
      label,
      onChange,
      delay = 175,
      completionDelay = 2500,
    } = {},
  ) {
    return mount(root, "taskPlan", (on, cleanup) => {
      root.classList.add("task-plan-progress");
      if (!trigger) {
        trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "task-plan-trigger";
        trigger.setAttribute("aria-label", "任务计划");
        marker = document.createElement("span");
        marker.className = "task-step-marker";
        marker.setAttribute("role", "img");
        label = document.createElement("span");
        label.className = "plan-num";
        trigger.append(marker, label);
        list = document.createElement("ol");
        list.className = "task-plan-list";
        list.hidden = true;
        root.replaceChildren(trigger, list);
      }
      let timer, hideTimer;
      const labels = {
        pending: "尚未开始",
        in_progress: "正在进行",
        completed: "已完成",
        failed: "失败",
      };
      function mark(el, state) {
        el.className = "task-step-marker " + state;
        el.setAttribute("aria-label", labels[state]);
        el.replaceChildren();
        if (state === "completed") {
          const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          svg.setAttribute("viewBox", "0 0 16 16");
          svg.setAttribute("aria-hidden", "true");
          svg.setAttribute("fill", "none");
          const path = document.createElementNS(svg.namespaceURI, "path");
          path.setAttribute("d", "m4.1 8.2 2.5 2.5 5.4-5.6");
          path.setAttribute("stroke", "currentColor");
          path.setAttribute("stroke-width", "1.7");
          svg.append(path);
          el.append(svg);
        } else if (state === "failed") {
          el.textContent = "!";
        }
      }
      function cancel() {
        clearTimeout(timer);
      }
      function setOpen(open) {
        trigger.setAttribute("aria-expanded", String(open));
        list.hidden = !open;
      }
      const disclosure = global.ArtemisUI.disclosure(trigger, list); // owns the ARIA relationship and instance identity
      disclosure.destroy();
      on(trigger, "pointerenter", () => {
        if (root.classList.contains("plan-gone")) return;
        cancel();
        timer = setTimeout(() => setOpen(true), delay);
      });
      on(trigger, "pointerleave", cancel);
      on(trigger, "focus", () => {
        cancel();
        setOpen(true);
      });
      on(trigger, "click", () => {
        cancel();
        setOpen(true);
      });
      on(root, "pointerleave", () => {
        cancel();
        setOpen(false);
      });
      on(root, "focusout", (e) => {
        if (!root.contains(e.relatedTarget)) {
          cancel();
          setOpen(false);
        }
      });
      on(root.ownerDocument, "pointerdown", (e) => {
        if (!root.contains(e.target)) {
          cancel();
          setOpen(false);
        }
      });
      on(root.ownerDocument, "keydown", (e) => {
        if (
          e.key === "Escape" &&
          trigger.getAttribute("aria-expanded") === "true" &&
          !e.defaultPrevented
        ) {
          e.preventDefault();
          setOpen(false);
        }
      });
      function update(data) {
        cancel();
        clearTimeout(hideTimer);
        if (!data.steps?.length) {
          root.classList.add("plan-gone");
          setOpen(false);
          return;
        }
        cancel();
        clearTimeout(hideTimer);
        root.classList.remove("plan-gone");
        steps = data.steps;
        index = Math.max(0, Math.min(data.index || 0, steps.length - 1));
        statuses = data.statuses || [];
        const states = steps.map((_, i) => {
          const value = Object.hasOwn(labels, statuses[i])
            ? statuses[i]
            : "pending";
          return i === index && value === "pending" ? "in_progress" : value;
        });
        list.replaceChildren();
        steps.forEach((text, i) => {
          const row = document.createElement("li");
          row.className = "task-plan-step " + states[i];
          const icon = document.createElement("span");
          icon.setAttribute("role", "img");
          mark(icon, states[i]);
          const title = document.createElement("span");
          title.textContent = text;
          row.append(icon, title);
          list.append(row);
        });
        mark(marker, states[index]);
        label.textContent = "第 " + (index + 1) + " / " + steps.length + " 步";
        if (states.every((state) => state === "completed")) {
          setOpen(false);
          hideTimer = setTimeout(() => {
            root.classList.add("plan-gone");
            onChange?.("hidden");
          }, completionDelay);
        }
      }
      cleanup(() => {
        cancel();
        clearTimeout(hideTimer);
        setOpen(false);
      });
      setOpen(false);
      update({ steps, index, statuses });
      return { update, setOpen };
    });
  }
  global.ArtemisPatterns = Object.freeze({ goalEditor, taskPlan });
})(window);

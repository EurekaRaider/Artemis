import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Real renderer hover; disabled snapshots are explicitly CSS probes on this
// isolated profile, never a claim that business logic disabled the operation.
export async function probeControlStates(page, output, record, seen) {
  const directory = join(output, "component-states");
  await mkdir(directory, { recursive: true });
  const entries = [];
  for (const handle of await page
    .locator(
      'button, a[href], [data-artemis-component="checkbox"] [data-part="indicator"], [data-artemis-component="switch"] [data-part="track"]',
    )
    .elementHandles()) {
    let descriptor;
    try {
      descriptor = await handle.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const modal = document.querySelector("dialog:modal");
        if (modal && !modal.contains(element)) return null;
        if (
          !element.checkVisibility({ visibilityProperty: true }) ||
          box.width < 4 ||
          box.height < 4 ||
          box.left < 0 ||
          box.top < 0 ||
          box.right > innerWidth ||
          box.bottom > innerHeight
        )
          return null;
        for (
          let parent = element.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent);
          const clip = parent.getBoundingClientRect();
          const left = clip.left + parent.clientLeft;
          const top = clip.top + parent.clientTop;
          if (
            (/hidden|clip|scroll|auto/.test(style.overflowX) &&
              (box.left < left - 1 ||
                box.right > left + parent.clientWidth + 1)) ||
            (/hidden|clip|scroll|auto/.test(style.overflowY) &&
              (box.top < top - 1 || box.bottom > top + parent.clientHeight + 1))
          )
            return null;
        }
        const s = getComputedStyle(element);
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        if (
          hit &&
          !element.contains(hit) &&
          !element.matches(".project-action, .project-new-thread, .thread-action") &&
          !element.closest(
            '[data-artemis-component="checkbox"], [data-artemis-component="switch"]',
          )?.contains(hit)
        )
          return null;
        const owner = element.parentElement?.closest(
          "[data-artemis-component]",
        );
        const selected =
          element.matches(
            "[aria-selected=true],[aria-checked=true],[aria-pressed=true],.active,.selected",
          ) ||
          element.closest(
            '[data-artemis-component="checkbox"][data-state="checked"], [data-artemis-component="switch"][data-state="checked"]',
          );
        const disabled =
          element.matches(":disabled") ||
          Boolean(
            element
              .closest(
                '[data-artemis-component="checkbox"], [data-artemis-component="switch"]',
              )
              ?.querySelector(":disabled"),
          );
        const clean = (value) =>
          value
            ?.split(/\s+/)
            .filter(
              (name) =>
                !["active", "selected", "checked", "disabled", "on"].includes(
                  name,
                ),
            )
            .join(".") ?? "";
        const paintedContext = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const state = parent.matches('[aria-selected=true],[aria-checked=true],[aria-pressed=true],.active,.selected,[data-state=checked]');
          if (state || style.backgroundColor !== "rgba(0, 0, 0, 0)")
            paintedContext.push({ background: style.backgroundColor, selected: state });
          if (parent.matches(".app-shell")) break;
        }
        return {
          tag: element.tagName,
          component: element.dataset.artemisComponent,
          classes: clean(element.className),
          owner: owner?.dataset.artemisComponent,
          ownerClasses: clean(owner?.className),
          paintedContext,
          variant: element.dataset.variant,
          icons: [...element.querySelectorAll("svg")].map(
            (icon) =>
              icon.dataset.artemisIcon ??
              icon.querySelector("path")?.getAttribute("d"),
          ),
          role: element.getAttribute("role"),
          text: element.textContent.trim().slice(0, 100),
          state: disabled ? "disabled" : selected ? "selected" : "default",
          nativeButton: element instanceof HTMLButtonElement,
          rect: box.toJSON(),
          font: s.fontFamily,
          size: s.fontSize,
          weight: s.fontWeight,
          padding: s.padding,
          radius: s.borderRadius,
        };
      });
    } catch {
      continue;
    }
    if (!descriptor) continue;
    const family = {
      theme: record.theme,
      locale: record.locale,
      tag: descriptor.tag,
      component: descriptor.component,
      classes: descriptor.classes,
      owner: descriptor.owner,
      ownerClasses: descriptor.ownerClasses,
      paintedContext: descriptor.paintedContext,
      variant: descriptor.variant,
      role: descriptor.role,
      icons: descriptor.icons,
      height: descriptor.rect.height,
      font: descriptor.font,
      size: descriptor.size,
      weight: descriptor.weight,
      padding: descriptor.padding,
      radius: descriptor.radius,
    };
    const familyId = createHash("sha256")
      .update(JSON.stringify(family))
      .digest("hex")
      .slice(0, 12);
    const key = familyId + ":" + descriptor.state;
    if (seen.has(key)) continue;
    const contextBox = await handle.evaluate((element) =>
      (element.matches(".project-action, .project-new-thread, .thread-action")
        ? element.parentElement?.parentElement
        : element.closest(".project-row, .project-thread-row, .goal-bar")
      )
        ?.getBoundingClientRect()
        .toJSON(),
    );
    const moveToContext = async () => {
      if (contextBox?.width && contextBox?.height)
        await page.mouse.move(
          contextBox.x + contextBox.width / 2,
          contextBox.y + contextBox.height / 2,
        );
      else await page.mouse.move(0, 0);
      await page.waitForTimeout(180);
    };
    const entry = {
      familyId,
      family,
      fixture: record.id,
      descriptor,
      context: contextBox
        ? "actual container hover reveals its actions"
        : "default container",
      samples: [],
    };
    const capture = async (state) => {
      const values = await handle.evaluate((element) => {
        const s = getComputedStyle(element);
        const leaf =
          element.querySelector('[data-part="label"],strong,span') ?? element;
        return {
          rect: element.getBoundingClientRect().toJSON(),
          color: s.color,
          background: s.backgroundColor,
          border: s.borderColor,
          opacity: s.opacity,
          font: s.fontFamily,
          size: s.fontSize,
          weight: s.fontWeight,
          textColor: getComputedStyle(leaf).color,
          disabled: element.matches(":disabled"),
          hovered:
            element.matches(":hover") ||
            Boolean(
              element
                .closest(
                  '[data-artemis-component="checkbox"], [data-artemis-component="switch"]',
                )
                ?.matches(":hover"),
            ),
          selected:
            element.getAttribute("aria-selected") ??
            element.getAttribute("aria-checked") ??
            element.getAttribute("aria-pressed"),
        };
      });
      if (state === "hover" && !values.hovered)
        throw new Error(
          "The real pointer did not hover the control or its checkbox/switch owner",
        );
      const b = values.rect;
      if (b.width < 1 || b.height < 1) return;
      const file = `${familyId}-${descriptor.state}-${state}.png`;
      await page.screenshot({
        path: join(directory, file),
        clip: { x: b.x, y: b.y, width: b.width, height: b.height },
        scale: "css",
      });
      entry.samples.push({
        state,
        kind:
          state === "disabled-css-probe"
            ? "temporary native disabled attribute, production CSS only"
            : "actual renderer state",
        screenshot: "component-states/" + file,
        ...values,
      });
    };
    try {
      await moveToContext();
      await capture("baseline");
      // Sidebar row actions are revealed by their row. Move the real pointer
      // through the row before its action; do not force an intercepted hover.
      const box = await handle.boundingBox();
      if (!box) throw new Error("Control disappeared before hover");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(180);
      await capture("hover");
      if (descriptor.nativeButton && descriptor.state !== "disabled") {
        await handle.evaluate((element) => {
          element.disabled = true;
        });
        try {
          await moveToContext();
          await capture("disabled-css-probe");
        } finally {
          await handle
            .evaluate((element) => {
              element.disabled = false;
            })
            .catch(() => {});
        }
      }
    } catch (error) {
      entry.error = String(error);
    }
    if (!entry.error) seen.add(key);
    entries.push(entry);
  }
  await page.mouse.move(0, 0);
  await writeFile(
    join(directory, record.id + ".json"),
    JSON.stringify(entries, null, 2),
  );
  return entries;
}

import { writeFile } from "node:fs/promises";
import type { BrowserWindow } from "electron";
import type { DesignService } from "./design-service.js";
import type { DesignContent } from "@artemis/protocol";

/** Native acceptance fixture, reached only through the existing smoke runner. */
export async function runDesignSmoke(
  window: BrowserWindow,
  service: DesignService,
  output: string,
) {
  const checks: Array<{ name: string; passed: boolean }> = [];
  const check = (name: string, condition: unknown) => {
    checks.push({ name, passed: Boolean(condition) });
    if (!condition) throw new Error(name);
  };
  const read = (script: string): Promise<any> =>
    window.webContents.executeJavaScript(script);
  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (script: string) => {
    for (let i = 0; i < 80; i++) {
      const value = await read(script);
      if (value) return value;
      await wait(100);
    }
    throw new Error(`Design UI timed out: ${script}`);
  };
  const click = async (text: string) => {
    await read(
      `[...document.querySelectorAll('.design-panel button')].find(button=>button.textContent===${JSON.stringify(text)})?.click()`,
    );
  };
  try {
    window.center();
    window.show();
    window.focus();
    const threadId = await until(
      "window.artemis.getSnapshot().then(s=>s.threads[0]?.id)",
    );
    await read("document.querySelector('.thread-select')?.click()");
    await until("document.querySelector('.model-button:not(:disabled)')");
    window.setMinimumSize(760, 680);
    window.setSize(820, 900);
    await read("document.querySelector('.model-button').click()");
    await until("document.querySelector('.model-picker-navigation button')");
    const geometry =
      "[...document.querySelectorAll('.model-picker-navigation button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})";
    let original = await read(geometry);
    let stable = 0;
    for (let attempt = 0; attempt < 40 && stable < 4; attempt++) {
      await wait(100);
      const next = await read(geometry);
      stable =
        JSON.stringify(next) === JSON.stringify(original) ? stable + 1 : 0;
      original = next;
    }
    check("menu layout settles after native window resize", stable === 4);
    check(
      "model picker navigation is compact and vertical",
      original.length === 2 &&
        original.every((r: any) => r.height < 50) &&
        original[1].y > original[0].y,
    );
    for (let index = 0; index < 20; index++) {
      const target = original[index % 2];
      window.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(target.x + 12),
        y: Math.round(target.y + target.height / 2),
      });
      await wait(35);
      const current = await read(geometry);
      await writeFile(
        `${output}.hover-geometry.json`,
        JSON.stringify({ original, current, index }),
      );
      check(
        `native hover geometry ${index + 1}`,
        current.length === 2 &&
          current.every(
            (r: any, i: number) =>
              Math.abs(r.x - original[i].x) <= 1 &&
              Math.abs(r.y - original[i].y) <= 1 &&
              Math.abs(r.height - original[i].height) <= 1,
          ),
      );
    }
    await writeFile(
      `${output}.model-picker.png`,
      (await window.webContents.capturePage()).toPNG(),
    );
    await read("document.querySelector('.model-button').click()");
    window.setSize(1540, 1000);
    const page = (id: string, name: string) => ({
      id,
      name,
      html: `<html><head><style>body{font:16px system-ui;padding:24px;background:#f5f7fb;color:#172035}h1{color:var(--design-color)}button{padding:8px 16px}main{display:grid;gap:var(--design-gap)}</style></head><body><main data-design-id="root" data-design-container><h1 data-design-id="heading" data-design-text="static">Design fixture</h1><span data-design-id="binding" data-design-bind="state"></span><button data-design-id="button" onclick="document.querySelector('output').textContent='Clicked'">Try interaction</button><output data-design-id="output"></output></main><aside data-design-id="aside" data-design-container></aside></body></html>`,
      parameters: [
        {
          name: "--design-gap",
          min: 0,
          max: 40,
          value: 8,
          unit: "px" as const,
        },
        { name: "--design-color", kind: "color" as const, value: "#2463eb" },
      ],
      data: { state: "Ready" },
    });
    const content: DesignContent = {
      schemaVersion: 1,
      title: "Design acceptance",
      brief: "Synthetic desktop fixture",
      basis: [],
      interactionNotes: "Button updates a simulated result.",
      variants: [
        {
          id: "compact",
          name: "Compact",
          description: "Compact flow",
          pages: [page("settings", "Settings"), page("result", "Result")],
        },
        {
          id: "spacious",
          name: "Spacious",
          description: "Spacious flow",
          pages: [page("settings", "Settings")],
        },
      ],
    };
    const saved = await service.action(threadId, {
      action: "save",
      operationId: "smoke-design-first",
      baseRevision: null,
      content,
    });
    await service.action(threadId, { action: "workflow", workflow: "design" });
    await until(
      "document.querySelector('.design-panel select[aria-label=\"选中元素\"] option[value=heading]')",
    );
    check(
      "real App opens Design panel",
      await until("!!document.querySelector('.design-workflow-badge')"),
    );
    await click("运行预览");
    for (
      let i = 0;
      i < 50 && service.preview.state(threadId)?.status !== "running";
      i++
    )
      await wait(100);
    check(
      "native preview starts from the saved revision",
      service.preview.state(threadId)?.revisionId ===
        saved.revision!.revisionId,
    );
    await read(
      "(()=>{const node=document.querySelector('.design-panel select[aria-label=\"选中元素\"]');node.value='heading';node.dispatchEvent(new Event('change',{bubbles:true}))})()",
    );
    await until(
      "document.querySelector('.design-inspector textarea:not(:disabled)')",
    );
    window.webContents.focus();
    await read(
      "(()=>{const node=document.querySelector('.design-inspector textarea');node.focus();node.select()})()",
    );
    await window.webContents.insertText("中文编辑完成");
    await until(
      "document.querySelector('.design-inspector textarea').value==='中文编辑完成'",
    );
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await until(
      "document.querySelector('.design-panel').textContent.includes('1 项未保存编辑')",
    );
    check("manual draft is retained before save", service.hasDrafts(threadId));
    for (let i = 0; i < 50 && !service.preview.state(threadId)?.draft; i++)
      await wait(100);
    check("draft preview is temporary", service.preview.state(threadId)?.draft);
    await click("撤销");
    await until(
      "!document.querySelector('.design-panel').textContent.includes('项未保存编辑')",
    );
    for (let i = 0; i < 50 && service.preview.state(threadId)?.draft; i++)
      await wait(100);
    check(
      "undo restores the saved preview",
      !service.preview.state(threadId)?.draft,
    );
    check(
      "undo restores the text editor",
      await read(
        "document.querySelector('.design-inspector textarea').value==='Design fixture'",
      ),
    );
    await click("重做");
    await until(
      "document.querySelector('.design-panel').textContent.includes('1 项未保存编辑')",
    );
    check(
      "redo restores Chinese draft text",
      await read(
        "document.querySelector('.design-inspector textarea').value==='中文编辑完成'",
      ),
    );
    await click("保存新版本");
    await until(
      "!document.querySelector('.design-panel').textContent.includes('项未保存编辑')",
    );
    const latest = (await service.state(threadId)).documents[0]!;
    const reopened = await service.action(threadId, {
      action: "read",
      documentId: latest.documentId,
    });
    check(
      "Chinese edit persists in immutable source",
      reopened.revision?.content.variants[0]?.pages[0]?.html.includes(
        "中文编辑完成",
      ),
    );
    check(
      "save created a new revision",
      reopened.revision?.revisionId !== saved.revision?.revisionId,
    );
    await click("截图检查");
    await until("document.querySelector('.design-thumbnails img')");
    check(
      "actual inspection thumbnail appears",
      await read(
        "document.querySelector('.design-thumbnails img').naturalWidth>0",
      ),
    );
    await writeFile(
      `${output}.design.png`,
      (await window.webContents.capturePage()).toPNG(),
    );
    await service.action(threadId, { action: "stop" });
    check(
      "trusted stop works",
      service.preview.state(threadId)?.status === "stopped",
    );
    await service.action(threadId, { action: "workflow", workflow: "code" });
  } finally {
    await writeFile(
      `${output}.last-frame.png`,
      (await window.webContents.capturePage()).toPNG(),
    ).catch(() => {});
    await writeFile(
      `${output}.last-dom.txt`,
      String(
        await read(
          "document.querySelector('.design-panel')?.textContent",
        ).catch(() => ""),
      ),
    );
    service.preview.stop();
    await writeFile(
      `${output}.design-checks.json`,
      JSON.stringify(checks, null, 2),
    );
  }
}

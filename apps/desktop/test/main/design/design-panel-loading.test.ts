import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { expect, it } from "vitest";

it("binds only loaded active documents, rejects late responses and exposes read errors", async () => {
  const html = await readFile(
    new URL(
      "../../../resources/design-plugins/artemis-design/panel/index.html",
      import.meta.url,
    ),
    "utf8",
  );
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  try {
    const { window } = dom;
    window.HTMLCanvasElement.prototype.getContext = (() => ({
      clearRect() {},
    })) as any;
    const sent: any[] = [];
    let receive: (event: { data: any }) => void = () => {};
    const port = {
      postMessage: (data: any) => sent.push(data),
      addEventListener: (_: string, listener: typeof receive) => {
        receive = listener;
      },
      start() {},
    };
    const event = new window.Event("artemis:port");
    Object.assign(event, { ports: [port] });
    window.dispatchEvent(event);
    const docs = [
      { path: "customer.html", bytes: 100 },
      { path: "orders.html", bytes: 100 },
    ];
    receive({ data: { type: "snapshot", snapshot: { projectFiles: docs } } });
    const click = (id: string) =>
      (
        window.document.querySelector(
          `[data-dz-project-path="${id}"]`,
        ) as HTMLElement
      ).click();
    const request = () =>
      sent.findLast((item) => item.type === "read-project-file-request");
    const reply = (read: any, data: any) =>
      receive({
        data: {
          ...read,
          type: "read-project-file-result",
          name: read.path,
          ...data,
        },
      });
    click("customer.html");
    const customer = request();
    expect(
      sent.findLast((item) => item.type === "active-document").documentId,
    ).toBeNull();
    click("orders.html");
    const orders = request();
    reply(customer, { content: "<h1>Customer</h1>", name: "customer.html" });
    expect(
      window.document.querySelector("#dzProjectFrame")?.getAttribute("srcdoc"),
    ).toBeNull();
    reply(orders, { content: "<h1>Orders</h1>", name: "orders.html" });
    expect(
      sent.findLast((item) => item.type === "active-document"),
    ).toMatchObject({
      documentId: "panel-project:orders.html",
      html: "<h1>Orders</h1>",
    });
    click("customer.html");
    receive({
      data: {
        ...request(),
        type: "read-project-file-error",
        error: "Read denied",
      },
    });
    expect(window.document.querySelector(".mock-empty")?.textContent).toContain(
      "Read denied",
    );
    expect(window.document.querySelector("#dzSource")?.textContent).toBe("");
    expect(
      sent.findLast((item) => item.type === "active-document").documentId,
    ).toBeNull();
    click("customer.html");
    reply(request(), { content: "", name: "customer.html" });
    expect(
      sent.findLast((item) => item.type === "active-document").documentId,
    ).toBe("panel-project:customer.html");
    (window.document.querySelector("#dzTabFiles") as HTMLElement).click();
    reply(request(), {
      content: "<h1>Background refresh</h1>",
      name: "customer.html",
    });
    expect(
      sent.findLast((item) => item.type === "active-document").documentId,
    ).toBeNull();
  } finally {
    dom.window.close();
  }
});

it("offers a staged start, hides unavailable actions, and opens project files only on request", async () => {
  const html = await readFile(
    new URL(
      "../../../resources/design-plugins/artemis-design/panel/index.html",
      import.meta.url,
    ),
    "utf8",
  );
  const errors: unknown[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
  });
  try {
    const { window } = dom;
    const element = (id: string) =>
      window.document.getElementById(id) as HTMLButtonElement;
    for (const id of ["dzExportBtn", "dzHistoryBtn", "dzPresentBtn"])
      expect(element(id).disabled).toBe(true);
    element("dzStartBtn").click();
    expect(element("dzToast").closest("[hidden]")).toBeNull();
    expect(element("dzToast").textContent).toContain("尚未连接");
    const sent: any[] = [];
    let receive = (_: any) => {};
    const port = {
      postMessage: (data: any) => sent.push(data),
      start() {},
      addEventListener: (_: string, callback: any) => {
        receive = callback;
      },
    };
    const event = new window.Event("artemis:port");
    Object.assign(event, { ports: [port] });
    window.dispatchEvent(event);
    receive({
      data: {
        type: "snapshot",
        snapshot: {
          documents: [],
          projectFiles: [],
          canOpenProject: true,
          designTask: false,
        },
      },
    });
    expect(element("dzCatEmpty").hidden).toBe(true);
    expect(element("dzOpenProjectBtn").hidden).toBe(false);
    expect(sent.some((item) => item.type === "open-project-file-request")).toBe(
      false,
    );
    element("dzStartBtn").click();
    expect(sent.at(-1)).toMatchObject({
      type: "candidate-prompt",
      autoSend: false,
    });
    expect(sent.at(-1).text).toContain("设计工具");
    element("dzOpenProjectBtn").click();
    expect(sent.at(-1).type).toBe("open-project-file-request");
    receive({
      data: { type: "open-project-file-result", error: "Outside workspace" },
    });
    expect(element("dzToast").textContent).toBe("Outside workspace");
    expect(element("dzToast").closest("[hidden]")).toBeNull();
    receive({
      data: { type: "snapshot", snapshot: { documents: [], designTask: true } },
    });
    element("dzStartBtn").click();
    expect(sent.at(-1).text).toContain("设计工具");
    expect(errors).toEqual([]);
  } finally {
    dom.window.close();
  }
});

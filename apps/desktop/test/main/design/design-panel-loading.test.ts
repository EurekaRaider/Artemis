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
      { documentId: "seed-customer", name: "customer.html" },
      { documentId: "seed-orders", name: "orders.html" },
    ];
    receive({ data: { type: "snapshot", snapshot: { documents: docs } } });
    const click = (id: string) =>
      (
        window.document.querySelector(`[data-dz-doc-id="${id}"]`) as HTMLElement
      ).click();
    const request = () =>
      sent.findLast((item) => item.type === "read-document-request");
    const reply = (read: any, data: any) =>
      receive({ data: { ...read, type: "document-html", ...data } });
    click("seed-customer");
    const customer = request();
    expect(
      sent.findLast((item) => item.type === "active-document").documentId,
    ).toBeNull();
    click("seed-orders");
    const orders = request();
    reply(customer, { html: "<h1>Customer</h1>", name: "customer.html" });
    expect(
      window.document.querySelector("#dzDocFrame")?.getAttribute("srcdoc"),
    ).toBeNull();
    reply(orders, { html: "<h1>Orders</h1>", name: "orders.html" });
    expect(
      sent.findLast((item) => item.type === "active-document"),
    ).toMatchObject({ documentId: "seed-orders", html: "<h1>Orders</h1>" });
    click("seed-customer");
    reply(request(), { html: "", error: "Read denied" });
    expect(window.document.querySelector(".mock-empty")?.textContent).toContain(
      "Read denied",
    );
    expect(window.document.querySelector("#dzSource")?.textContent).toBe("");
    expect(
      sent.findLast((item) => item.type === "active-document").documentId,
    ).toBeNull();
    click("seed-customer");
    reply(request(), { html: "", name: "customer.html" });
    expect(
      sent.findLast((item) => item.type === "active-document").documentId,
    ).toBe("seed-customer");
    (window.document.querySelector("#dzTabFiles") as HTMLElement).click();
    reply(request(), {
      html: "<h1>Background refresh</h1>",
      name: "customer.html",
    });
    expect(
      sent.findLast((item) => item.type === "active-document").documentId,
    ).toBeNull();
  } finally {
    dom.window.close();
  }
});

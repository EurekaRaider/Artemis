import { describe, expect, it } from "vitest";
import {
  designParameterCss,
  patchDesignSource,
  type DesignSource,
} from "../src/main/design-source.js";

const source = (): DesignSource => ({
  html: '<button data-design-id="button"><svg></svg><span data-design-id="label" data-design-text="static">保存</span></button><script>window.state=1</script>',
  parameters: [{ name: "--design-gap", min: 0, max: 32, value: 8, unit: "px" }],
});

describe("design source editing", () => {
  it("preserves icons and scripts while escaping leaf text and round-tripping parameters", () => {
    const edited = patchDesignSource(source(), [
      { type: "text", elementId: "label", text: "<中文>" },
      { type: "parameter", name: "--design-gap", value: 12 },
    ]);
    expect(edited.html).toContain("<svg></svg>");
    expect(edited.html).toContain("&lt;中文&gt;");
    expect(edited.html).toContain("window.state=1");
    expect(patchDesignSource(JSON.parse(JSON.stringify(edited)), [])).toEqual(
      edited,
    );
    expect(designParameterCss(edited)).toBe(":root{--design-gap:12px;}");
  });
  it("rejects parents, missing IDs, undeclared slots, and duplicate IDs including templates", () => {
    for (const id of ["button", "missing"])
      expect(() =>
        patchDesignSource(source(), [
          { type: "text", elementId: id, text: "x" },
        ]),
      ).toThrow();
    const duplicate = source();
    duplicate.html +=
      '<template><span data-design-id="label"></span></template>';
    expect(() => patchDesignSource(duplicate, [])).toThrow(/unique/);
  });
  it("rejects unsafe parameter declarations and values without modifying the input", () => {
    const original = source();
    for (const value of [33, -1, NaN, Infinity])
      expect(() =>
        patchDesignSource(original, [
          { type: "parameter", name: "--design-gap", value },
        ]),
      ).toThrow();
    expect(original.parameters[0]!.value).toBe(8);
    original.parameters[0]!.name = "--design-x:url(https://example.com)";
    expect(() => designParameterCss(original)).toThrow();
  });
  it("rejects oversized edits before returning a replacement source", () => {
    expect(() =>
      patchDesignSource(source(), [
        { type: "text", elementId: "label", text: "x".repeat(65537) },
      ]),
    ).toThrow(/64 KiB/);
  });
});

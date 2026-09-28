import { describe, expect, it } from "vitest";
import { parseWorkspaceCsv } from "../src/renderer/workspace-csv.js";

describe("CSV preview", () => {
  it("preserves BOM, identifiers, empty fields, quoted commas, escaped quotes and newlines", () => {
    expect(
      parseWorkspaceCsv(
        '\uFEFF编号,备注,值\r\n001,"a,b",\r\n002,"say ""hi""\nnext",=SUM(A1)\r\n',
      ),
    ).toEqual({
      rows: [
        ["编号", "备注", "值"],
        ["001", "a,b", ""],
        ["002", 'say "hi"\nnext', "=SUM(A1)"],
      ],
      truncated: false,
      invalid: false,
    });
  });
  it("bounds rows and columns and distinguishes malformed quotes", () => {
    expect(parseWorkspaceCsv("a,b,c\n1,2,3\n4,5,6", 2, 2)).toEqual({
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      truncated: true,
      invalid: false,
    });
    expect(parseWorkspaceCsv('a,"unfinished').invalid).toBe(true);
    expect(parseWorkspaceCsv('"closed"oops').invalid).toBe(true);
    expect(parseWorkspaceCsv("").rows).toEqual([]);
    expect(parseWorkspaceCsv("a,,").rows).toEqual([["a", "", ""]]);
  });
});

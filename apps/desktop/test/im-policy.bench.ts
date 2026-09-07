import { bench, describe } from "vitest";
import { inspectImOutbound } from "../src/main/im-policy.js";

// Includes the worker/runtime baseline; the high-water mark is not an estimate
// of detector-only allocations. Keep this alongside latency for reproducibility.
const before = process.memoryUsage();
const largeInput = "ordinary code example: password validation and test-token\n"
  .repeat(Math.ceil((10 * 1024 * 1024) / 56))
  .slice(0, 10 * 1024 * 1024);
for (let i = 0; i < 20; i++) inspectImOutbound(largeInput);
console.info("IM scan memory (20 x 10 MiB)", {
  before,
  after: process.memoryUsage(),
  maxRssKiB: process.resourceUsage().maxRSS,
});

describe("local IM outbound checks (no model or network calls)", () => {
  for (const size of [4096, 1024 * 1024, 10 * 1024 * 1024]) {
    const text = "ordinary code example: password validation and test-token\n"
      .repeat(Math.ceil(size / 56))
      .slice(0, size);
    bench(`${size} bytes`, () => {
      inspectImOutbound(text);
    });
  }
});

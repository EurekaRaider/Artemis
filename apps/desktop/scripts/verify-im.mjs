// The legacy shared-space UI is retired; keep its historical harness opt-in.
await import(
  process.argv.includes("--legacy")
    ? "./verify-im-legacy.mjs"
    : "./verify-im-native.mjs"
);

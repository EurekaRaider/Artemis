// S0 test-shapes runtime stub. Identical lifecycle contract to test-notes but
// a different plugin id: proves the host treats both through one generic
// path with zero per-plugin branches.
process.on("message", (message) => {
  if (message && message.type === "hello") {
    process.send?.({
      type: "ready",
      protocolVersion: 1,
      pluginId: "com.artemis.s0.test-shapes",
    });
  }
});

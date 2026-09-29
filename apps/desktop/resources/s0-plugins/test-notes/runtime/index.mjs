// S0 test-notes runtime stub. The real stdio protocol lands in S2; S0 only
// needs the entry to exist, load, and report readiness so the host can prove
// process lifecycle (spawn, deny, teardown) without business logic.
process.on("message", (message) => {
  if (message && message.type === "hello") {
    process.send?.({
      type: "ready",
      protocolVersion: 1,
      pluginId: "com.artemis.s0.test-notes",
    });
  }
});

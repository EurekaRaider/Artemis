// The composition root supplies live getters for replaceable services.
// Feature owners request a narrow Pick of this type; this import emits no code.
export type ApplicationServices = ReturnType<
  typeof import("../main.js").createApplicationServices
>;

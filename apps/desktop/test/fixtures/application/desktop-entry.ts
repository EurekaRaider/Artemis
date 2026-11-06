import { app } from "electron";
import { bootstrapDesktop } from "../../../src/main/application/bootstrap-application.js";

// Only the development build uses this entrypoint. Packaged builds start at
// src/main/bootstrap.ts and have no import path to verification code.
if (!app.isPackaged && process.env.ARTEMIS_SMOKE_SCREENSHOT)
  app.disableHardwareAcceleration();

bootstrapDesktop(async () => {
  const application = await import("../../../src/main/main.js");
  if (
    !app.isPackaged &&
    Object.keys(process.env).some((name) => name.startsWith("ARTEMIS_SMOKE_"))
  ) {
    const { installSmokeHost } = await import("../smoke/host.js");
    installSmokeHost();
  }
  return application;
});

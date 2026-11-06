import { bootstrapDesktop } from "./application/bootstrap-application.js";

bootstrapDesktop(() => import("./main.js"));

import { validateStapledMacApp } from "./notarize-macos-app.mjs";

const appPath = process.argv[2];
if (!appPath) throw new Error("A stapled macOS app path is required.");
await validateStapledMacApp(appPath);

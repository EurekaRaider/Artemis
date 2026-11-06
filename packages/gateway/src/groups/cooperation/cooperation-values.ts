import { digest } from "../../store.js";
import { type NativeTask } from "./cooperation-types.js";
export const LOCALE_CAPABILITY = "Artemis locale/1";

export const objective = (text: string) =>
  digest(
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\p{P}\p{Z}\s]/gu, ""),
  );

export const terminal = (state: NativeTask["state"]) =>
  ["completed", "failed", "cancelled", "rejected"].includes(state);

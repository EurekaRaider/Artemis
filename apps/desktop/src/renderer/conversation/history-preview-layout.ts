import { createContext } from "react";

// Presentation metadata survives virtualization for the lifetime of this turn.
export const HistoryPreviewLayout = createContext<{
  paths: Map<string, string>;
  heights: Map<string, number>;
} | null>(null);

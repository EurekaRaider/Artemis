import { createContext } from "react";

export interface HistoryPreviewLayoutState {
  paths: Map<string, string>;
  heights: Map<string, number>;
  images: Map<string, string>;
  markup: Map<string, string>;
}

// Presentation metadata survives virtualization for the lifetime of this turn.
export const HistoryPreviewLayout =
  createContext<HistoryPreviewLayoutState | null>(null);

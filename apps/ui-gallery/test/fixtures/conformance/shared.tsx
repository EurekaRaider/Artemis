import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { Component, type ReactNode } from "react";

export const galleryCss = readFileSync("src/styles/gallery.css", "utf8");

export const workflowSource = readFileSync(
  "../../packages/ui/src/workflow.tsx",
  "utf8",
);

export const managementSource = readFileSync(
  "../../packages/ui/src/management.tsx",
  "utf8",
);

export const dataSource = readFileSync(
  "../../packages/ui/src/data.tsx",
  "utf8",
);

export const professionalSource = readFileSync(
  "../../packages/ui/src/professional.tsx",
  "utf8",
);

export const uiCss = readFileSync("../../packages/ui/src/styles.css", "utf8");

export const MatrixIcon = () => (
  <svg viewBox="0 0 16 16">
    <path d="M2 8h12" />
  </svg>
);

export class ProbeErrorBoundary extends Component<
  { readonly children: ReactNode; readonly onError: (error: Error) => void },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

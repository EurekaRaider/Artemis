import {
  artifactSelectionSchema,
  type ArtifactSelection,
} from "@artemis/protocol";

interface CreateOfficeSelectionOptionsContext {
  readonly session: {
    protocolVersion: 1;
    documentId: string;
    sessionId: string;
    path: string;
    format: "excel" | "powerpoint" | "word";
    engineVersion: string;
    version: number;
    savedVersion: number;
    savePath?: string | undefined;
    previewVersion: number | null;
    sequence: number;
    status:
      | "closed"
      | "conflict"
      | "editing"
      | "failed"
      | "opening"
      | "recovering"
      | "saved"
      | "saving";
    error?: string | undefined;
  };
  readonly selection:
    | {
        value: ArtifactSelection;
        version: number;
        quote?: string | undefined;
      }
    | undefined;
  readonly targets: {
    selection:
      | {
          kind: "paragraph";
          index: number;
          start: number;
          end: number;
        }
      | {
          kind: "object";
          page: number;
          index: number;
          path?: number[] | undefined;
          cell?:
            | {
                row: number;
                column: number;
              }
            | undefined;
        }
      | {
          kind: "cells";
          sheet: string;
          range: string;
        }
      | {
          kind: "region";
          page: number;
          x: number;
          y: number;
          width: number;
          height: number;
        };
    text: string;
    editable?: boolean | undefined;
    formula?: string | undefined;
    bounds?:
      | {
          x: number;
          y: number;
          width: number;
          height: number;
        }
      | undefined;
  }[];
  readonly selectionLabel: (value: ArtifactSelection) => string;
  readonly currentPage: number;
  readonly isSheet: boolean;
  readonly setFollowPaused: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setSelection: import("react").Dispatch<
    import("react").SetStateAction<
      | {
          value: ArtifactSelection;
          version: number;
          quote?: string | undefined;
        }
      | undefined
    >
  >;
  readonly setAnnotationOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setRange: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
}
export function createOfficeSelectionOptions(
  context: CreateOfficeSelectionOptionsContext,
) {
  const {
    session,
    selection,
    targets,
    selectionLabel,
    currentPage,
    isSheet,
    setFollowPaused,
    setSelection,
    setAnnotationOpen,
    setRange,
  } = context;
  const fileName = session.path.split(/[\\/]/u).pop() ?? session.path;
  const selectedValue = selection ? JSON.stringify(selection.value) : "";
  const validSelection =
    selection && artifactSelectionSchema.safeParse(selection.value).success;
  const quote =
    selection?.quote ??
    (selection?.version === session.version
      ? targets.find(
          (target) => JSON.stringify(target.selection) === selectedValue,
        )?.text
      : undefined);
  const targetOptions = (isSheet ? [] : targets)
    .filter(
      (target) =>
        target.selection.kind !== "object" ||
        target.selection.page === currentPage,
    )
    .slice(0, 2_000)
    .map((target) => ({
      value: JSON.stringify(target.selection),
      label:
        selectionLabel(target.selection) +
        (target.text ? ` · ${target.text.slice(0, 100)}` : ""),
    }));
  if (
    !isSheet &&
    selection &&
    !targetOptions.some((target) => target.value === selectedValue)
  ) {
    targetOptions.push({
      value: selectedValue,
      label: selectionLabel(selection.value),
    });
  }
  const chooseSelection = (
    value: ArtifactSelection,
    version = session.version,
    quote?: string,
  ) => {
    setFollowPaused(true);
    setSelection({ value, version, ...(quote ? { quote } : {}) });
    setAnnotationOpen(true);
    if (value.kind === "cells") setRange(value.range);
  };
  return {
    fileName,
    selectedValue,
    validSelection,
    quote,
    targetOptions,
    chooseSelection,
  };
}

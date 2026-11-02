import { useEffect, useState } from "react";
import type { AppLocale, Project } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Dialog } from "@artemis/ui/feedback";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import { WorkspaceFileEditor } from "./WorkspaceFileEditor.js";

export function ProjectInstructionsDialog({
  project,
  locale,
  onConfirm,
  onClose,
}: {
  project: Project;
  locale: AppLocale;
  onConfirm(message: string): Promise<boolean>;
  onClose(): void;
}) {
  const t = UI_COPY.App_copy[locale];
  const [original, setOriginal] = useState<string>();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string>();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const dirty = original !== undefined && original !== content;
  useEffect(() => {
    let current = true;
    void window.artemis.readProjectInstructions(project.id).then(
      (value) => {
        if (current) {
          setOriginal(value);
          setContent(value);
        }
      },
      (reason: unknown) => {
        if (current) setError(String(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [project.id]);
  const close = async () => {
    if (state === "saving") return;
    if (
      !dirty ||
      (await onConfirm(uiText(locale, "Review06.discardInstructions")))
    )
      onClose();
  };
  const save = async () => {
    if (!dirty || state === "saving") return;
    setState("saving");
    setError(undefined);
    try {
      await window.artemis.writeProjectInstructions(project.id, content);
      setOriginal(content);
      setState("saved");
    } catch (reason) {
      setError(String(reason));
      setState("idle");
    }
  };
  return (
    <Dialog
      className="project-instructions-dialog"
      open
      label={uiText(locale, "Review06.projectInstructions")}
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <h2>{uiText(locale, "Review06.projectInstructions")}</h2>
      <p className="project-instructions-path">
        <bdi>{project.path}/AGENTS.md</bdi>
      </p>
      {original === undefined ? (
        <p role={error ? "alert" : "status"}>{error ?? "…"}</p>
      ) : (
        <WorkspaceFileEditor
          ariaLabel="AGENTS.md"
          path="AGENTS.md"
          content={content}
          dirty={dirty}
          readOnly={state === "saving"}
          saveError={error}
          saveState={state}
          saveLabel={t.saveFile}
          savedLabel={t.saved}
          savingLabel={t.saving}
          unsavedLabel={t.unsaved}
          onChange={setContent}
          onSave={() => void save()}
        />
      )}
      <footer>
        <Button disabled={state === "saving"} onClick={() => void close()}>
          {t.renameCancel}
        </Button>
      </footer>
    </Dialog>
  );
}

import { useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { AppLocale, PromptAttachment } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { TextAreaField } from "@artemis/ui/forms";
import { ArtemisIcon } from "@artemis/ui/icons";
import {
  AttachmentFileIcon,
  attachmentFileType,
} from "./AttachmentFileIcon.js";
import { officeCopy } from "./office-copy.js";
import { officeAnnotationCopy } from "./office-annotation-copy.js";
import {
  officeSelectionLabel,
  readOfficeAnnotations,
  type OfficeAnnotationReference,
} from "./office-annotations.js";
import "./office-annotation-cards.css";

export function OfficeAnnotationCards({
  attachments,
  locale,
  disabled = false,
  onChange,
  onLocate,
}: {
  attachments: PromptAttachment[];
  locale: AppLocale;
  disabled?: boolean;
  onChange(index: number, id: string, text: string | undefined): boolean;
  onLocate(reference: OfficeAnnotationReference): void;
}) {
  const t = officeAnnotationCopy(locale);
  const office = officeCopy(locale);
  const prefix = useId();
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{
    index: number;
    id: string;
    path: string;
    text: string;
  }>();
  const groups = new Map<
    string,
    Array<OfficeAnnotationReference & { index: number }>
  >();
  attachments.forEach((attachment, index) => {
    const file = readOfficeAnnotations(attachment);
    if (!file) return;
    const entries = groups.get(file.path) ?? [];
    entries.push(
      ...file.annotations.map((annotation) => ({
        path: file.path,
        annotation,
        index,
      })),
    );
    groups.set(file.path, entries);
  });
  if (!groups.size) return null;
  const count = [...groups.values()].reduce(
    (sum, entries) => sum + entries.length,
    0,
  );
  const allCollapsed = [...groups.keys()].every((path) => collapsed.has(path));
  function toggle(set: Set<string>, path: string) {
    const next = new Set(set);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  }
  function closeEditor() {
    setEditing(undefined);
    window.requestAnimationFrame(() => editTrigger.current?.focus());
  }
  function save() {
    if (!editing || !editing.text.trim() || disabled) return;
    if (onChange(editing.index, editing.id, editing.text.trim())) closeEditor();
  }
  return (
    <div className="office-comment-cards">
      <div className="office-comment-summary">
        <ArtemisIcon name="message" width={16} height={16} />
        <span>
          {t.summary
            .replace("{count}", String(count))
            .replace("{files}", String(groups.size))}
        </span>
        <Button
          variant="quiet"
          onClick={() =>
            setCollapsed(allCollapsed ? new Set() : new Set(groups.keys()))
          }
        >
          {allCollapsed ? t.expand : t.collapse}
        </Button>
      </div>
      <div className="office-comment-list">
        {[...groups].map(([path, entries], groupIndex) => {
          const name = path.split(/[\\/]/u).at(-1) ?? path;
          const closed = collapsed.has(path);
          const full = expanded.has(path);
          const listId = `${prefix}-${groupIndex}`;
          return (
            <section
              className="office-comment-group"
              key={path}
              style={
                {
                  "--office-comment-color": attachmentFileType(path).color,
                } as CSSProperties
              }
              aria-label={path}
            >
              <button
                type="button"
                className="office-comment-file"
                aria-expanded={!closed}
                aria-controls={listId}
                title={path}
                onClick={() => setCollapsed(toggle(collapsed, path))}
              >
                <AttachmentFileIcon name={path} size={28} />
                <strong>{name}</strong>
                <span className="office-comment-count">{entries.length}</span>
                <ArtemisIcon
                  name={closed ? "chev-right" : "chevron"}
                  width={14}
                  height={14}
                />
              </button>
              <div id={listId} hidden={closed}>
                {(full ? entries : entries.slice(0, 3)).map(
                  ({ annotation, index }, position) => (
                    <div
                      className="office-comment-row"
                      key={`${index}:${annotation.id}`}
                    >
                      <span className="office-comment-number">
                        {position + 1}
                      </span>
                      <div className="office-comment-body">
                        <div className="office-comment-location">
                          {officeSelectionLabel(annotation.selection, locale)} ·{" "}
                          {office.version} {annotation.sourceVersion}
                        </div>
                        <p>{annotation.text}</p>
                      </div>
                      <div className="office-comment-actions">
                        <IconButton
                          label={`${t.locate}: ${position + 1}`}
                          icon={<ArtemisIcon name="target" />}
                          onClick={() => onLocate({ path, annotation })}
                          disabled={disabled}
                        />
                        <IconButton
                          label={`${t.edit}: ${position + 1}`}
                          icon={<ArtemisIcon name="edit" />}
                          onClick={(event) => {
                            editTrigger.current = event.currentTarget;
                            setEditing({
                              index,
                              id: annotation.id,
                              path,
                              text: annotation.text,
                            });
                          }}
                          disabled={disabled}
                        />
                        <IconButton
                          label={`${t.remove}: ${position + 1}`}
                          icon={<ArtemisIcon name="close" />}
                          onClick={() =>
                            onChange(index, annotation.id, undefined)
                          }
                          disabled={disabled}
                        />
                      </div>
                    </div>
                  ),
                )}
                {entries.length > 3 && (
                  <Button
                    className="office-comment-more"
                    variant="quiet"
                    onClick={() => setExpanded(toggle(expanded, path))}
                  >
                    {full
                      ? t.less
                      : t.more.replace("{count}", String(entries.length - 3))}
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {editing &&
        createPortal(
          <dialog
            className="office-comment-dialog"
            aria-label={t.edit}
            ref={(element) => {
              if (element && !element.open) element.showModal();
            }}
            onClose={closeEditor}
            onCancel={closeEditor}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                save();
              }
            }}
          >
            <strong>{editing.path.split(/[\\/]/u).at(-1)}</strong>
            <TextAreaField
              label={t.edit}
              value={editing.text}
              rows={5}
              maxLength={8192}
              autoFocus
              onValueChange={(text) => setEditing({ ...editing, text })}
            />
            <div className="office-comment-dialog-actions">
              <Button variant="quiet" onClick={closeEditor}>
                {t.cancel}
              </Button>
              <Button
                variant="primary"
                disabled={!editing.text.trim() || disabled}
                onClick={save}
              >
                {t.save}
              </Button>
            </div>
          </dialog>,
          document.body,
        )}
    </div>
  );
}

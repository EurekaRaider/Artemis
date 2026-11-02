import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppLocale, PromptAttachment } from "@artemis/protocol";
import { Toast, ToastViewport } from "@artemis/ui/feedback";
import { WorkspaceDock } from "@artemis/ui/workspace";
import { Badge, Button, IconButton, Keycap } from "@artemis/ui/actions";
import { Checkbox, Select, Switch, TextField } from "@artemis/ui/forms";
import { ComposerAttachments } from "../../src/renderer/conversation/ComposerAttachments.js";
import { ComposerSkillChip } from "../../src/renderer/conversation/ComposerSkillChip.js";
import { AttachmentImportProgress } from "../../src/renderer/conversation/AttachmentImportProgress.js";
import type { AttachmentImportProgress as ImportProgress } from "../../src/shared/api.js";
import {
  ArtemisIcon,
  ArtemisLogo,
  RunningArc,
  ARTEMIS_ICON_NAMES,
  ARTEMIS_VISUAL_ICON_NAMES,
} from "@artemis/ui/icons";
import {
  ResourceAvatar,
  RESOURCE_ICON_NAMES,
} from "../../src/renderer/plugins/resource-icons.js";
import { WorkspaceFileIcon } from "../../src/renderer/workspace/WorkspaceFilesPanel.js";
import { filePresentation } from "../../src/renderer/workspace/workspace-file-presentation.js";
import { WorkspaceCsvEditor } from "../../src/renderer/workspace/WorkspaceCsvEditor.js";
import { UpdateAnnouncement } from "../../src/renderer/updates/UpdateAnnouncement.js";
import { UI_COPY } from "../../src/shared/i18n/ui-copy.js";
import { uiText } from "../../src/shared/i18n/ui-text.js";
import "@artemis/ui/styles.css";
import "../../src/renderer/styles/styles.css";
import "../../src/renderer/styles/prototype-migration.css";
import "../../src/renderer/styles/nocturne.css";
import "@artemis/theme-artemis/theme.css";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") ?? "dark";
const locale = (params.get("locale") ?? "zh-CN") as AppLocale;
const view = params.get("view");
Object.assign(document.documentElement.dataset, {
  theme,
  material: "solid",
  artemisSkin: "com.artemis.default",
  artemisTheme: theme,
  artemisContrast: "normal",
});
document.documentElement.lang = locale;
document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";

if (view === "attachments") {
  // UI data only: this isolated page has no preload or real attachment service.
  let listener: ((item: ImportProgress) => void) | undefined;
  Object.assign(window, {
    fixtureAttachmentCancellations: [] as string[],
    artemis: {
      onAttachmentImportProgress(callback: (item: ImportProgress) => void) {
        listener = callback;
        queueMicrotask(() =>
          callback({
            id: "local-copy",
            name: "retrieval-survey.pdf",
            status: "saving",
            copied: 64,
            total: 100,
          }),
        );
        return () => {
          listener = undefined;
        };
      },
      async cancelPromptAttachment(id: string) {
        (
          window as unknown as { fixtureAttachmentCancellations: string[] }
        ).fixtureAttachmentCancellations.push(id);
        listener?.({
          id,
          name: "retrieval-survey.pdf",
          status: "saved",
          copied: 64,
          total: 100,
        });
      },
    },
  });
}

function Fixture() {
  const [csv, setCsv] = useState(
    "Name,Status,Count\nalpha,Reviewed,3\nbeta,Updated,42\ngamma,Pending,12\n",
  );
  const [notice, setNotice] = useState(true);
  const [messages, setMessages] = useState(["Task A", "Task B", "Task C"]);
  const [checked, setChecked] = useState(true);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([
    {
      type: "file",
      name: "notes.md",
      mimeType: "text/markdown",
      content: "Local UI fixture. No file is imported or sent.",
    },
  ]);
  const [skill, setSkill] = useState(true);
  return (
    <main
      className="app-shell"
      style={{
        height: "100vh",
        width: "100vw",
        display: "block",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      {["icons", "icons12", "icons14", "icons24"].includes(view) && (
        <section
          className="fixture-icons"
          data-expected-icons={
            ARTEMIS_ICON_NAMES.length + ARTEMIS_VISUAL_ICON_NAMES.length
          }
          data-icon-size={Number(view.slice(5)) || 16}
          style={{
            padding: 40,
            display: "grid",
            gridTemplateColumns: "repeat(12, 1fr)",
            gap: 16,
          }}
        >
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              gap: 24,
              alignItems: "center",
            }}
          >
            {[16, 24, 32, 48, 64, 128].map((size) => (
              <ArtemisLogo key={size} size={size} />
            ))}
          </div>
          {[...ARTEMIS_ICON_NAMES, ...ARTEMIS_VISUAL_ICON_NAMES].map((name) => (
            <div
              key={name}
              data-icon-catalog-entry={name}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ArtemisIcon
                name={name}
                width={Number(view.slice(5)) || 16}
                height={Number(view.slice(5)) || 16}
              />
              <small style={{ font: "10.5px var(--mono-font)" }}>{name}</small>
            </div>
          ))}
          {[
            "index.ts",
            "index.js",
            "data.json",
            "README.md",
            "index.html",
            "app.css",
            "table.xlsx",
            "notes.docx",
            "deck.pptx",
            "paper.pdf",
            "photo.png",
          ].map((path) => (
            <div key={path}>
              <WorkspaceFileIcon
                path={path}
                presentation={filePresentation(path)}
                symlink={false}
              />
              <small style={{ font: "10.5px var(--mono-font)" }}>{path}</small>
            </div>
          ))}
        </section>
      )}
      {view === "resource-icons" && (
        <section
          className="fixture-resource-icons resource-page"
          style={{
            padding: 40,
            display: "grid",
            gridTemplateColumns: "repeat(10, 1fr)",
            gap: 24,
          }}
        >
          {RESOURCE_ICON_NAMES.map((icon) => (
            <div
              key={icon}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <ResourceAvatar name={icon} kind="skill" iconKey={icon} />
              <small style={{ font: "10.5px var(--mono-font)" }}>{icon}</small>
            </div>
          ))}
        </section>
      )}
      {view === "controls" && (
        <section
          className="fixture-controls"
          style={{
            padding: 80,
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {(["primary", "secondary", "quiet", "danger"] as const).map(
              (variant, index) => (
                <Button
                  key={variant}
                  size="comfortable"
                  variant={variant}
                  iconSize="sm"
                  icon={
                    index === 0 ? (
                      <ArtemisIcon name="edit-square" width={14} height={14} />
                    ) : undefined
                  }
                >
                  {
                    (locale.startsWith("zh")
                      ? ["新任务", "评审变更", "取消", "还原文件"]
                      : [
                          "New task",
                          "Review changes",
                          "Cancel",
                          "Restore file",
                        ])[index]
                  }
                </Button>
              ),
            )}
            <Button disabled size="comfortable">
              Disabled
            </Button>
            <Button size="compact">
              {locale.startsWith("zh") ? "暂存" : "Stage"}
            </Button>
            <IconButton
              label="More"
              size="comfortable"
              icon={<ArtemisIcon name="more" width={16} height={16} />}
            />
            <Keycap>⌘K</Keycap>
          </div>
          <Checkbox
            label="Checkbox"
            checked={checked}
            onCheckedChange={setChecked}
          />
          <Checkbox
            label="Unchecked checkbox"
            checked={false}
            onCheckedChange={() => {}}
          />
          <Checkbox label="Disabled checkbox" checked disabled />
          <Switch
            label="Switch"
            checked={checked}
            onCheckedChange={setChecked}
          />
          <Switch label="Disabled switch" checked disabled />
          <TextField label="Name" value="Local fixture" onChange={() => {}} />
          <Select
            label="Model"
            labelVisibility="hidden"
            value="local"
            options={[{ value: "local", label: "Opus 5.5 · 思考 高" }]}
            onValueChange={() => {}}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Badge tone="warning" icon={<RunningArc size={12} />}>
              运行中 2:14
            </Badge>
            <Badge tone="warning">等待你的决定</Badge>
            <Badge
              tone="success"
              icon={<ArtemisIcon name="check" width={12} height={12} />}
            >
              已完成
            </Badge>
            <Badge
              tone="danger"
              icon={<ArtemisIcon name="alert" width={12} height={12} />}
            >
              失败
            </Badge>
            <Badge icon={<ArtemisIcon name="pause" width={12} height={12} />}>
              已暂停
            </Badge>
          </div>
        </section>
      )}
      {view === "attachments" && (
        <section
          className="composer"
          style={{ width: 700, margin: "80px auto", padding: 12 }}
        >
          <div className="composer-resource-strip">
            {skill && (
              <ComposerSkillChip
                skill={{
                  id: "local-skill",
                  name: "头脑风暴",
                  description: "Local UI fixture",
                  path: "/local/fixture",
                  enabled: true,
                }}
                removeLabel="Remove skill"
                onRemove={() => setSkill(false)}
              />
            )}
            <ComposerAttachments
              attachments={attachments}
              locale={locale}
              onRemove={(index) =>
                setAttachments((items) =>
                  items.filter((_, itemIndex) => itemIndex !== index),
                )
              }
            />
            <AttachmentImportProgress
              locale={locale}
              onImported={(items) =>
                setAttachments((current) => [...current, ...items])
              }
            />
          </div>
        </section>
      )}
      {view === "csv" && (
        <WorkspaceDock
          className="workspace-dock right-sidebar"
          label="CSV"
          open
          style={{
            width: 620,
            height: 720,
            margin: "80px auto",
            position: "relative",
          }}
        >
          <WorkspaceCsvEditor
            ariaLabel="review.csv"
            locale={locale}
            path="review.csv"
            content={csv}
            dirty={false}
            saveError={undefined}
            saveState="idle"
            saveLabel={uiText(locale, "App_copy.renameSave")}
            savedLabel={uiText(locale, "App_copy.saved")}
            savingLabel={uiText(locale, "App_copy.saving")}
            unsavedLabel={uiText(locale, "App_copy.unsaved")}
            previewLabel={UI_COPY.App_copy[locale].richText}
            sourceLabel={UI_COPY.App_copy[locale].sourceText}
            onChange={setCsv}
            onSave={() => {}}
          />
        </WorkspaceDock>
      )}
      {view === "notifications" && (
        <ToastViewport label={uiText(locale, "App_copy.dismissNotice")}>
          {messages.map((message) => (
            <Toast
              key={message}
              tone={
                message === "Task A"
                  ? "success"
                  : message === "Task B"
                    ? "danger"
                    : "warning"
              }
              dismissLabel={uiText(locale, "App_copy.renameClose")}
              onDismiss={() =>
                setMessages((items) => items.filter((item) => item !== message))
              }
            >
              {message}
            </Toast>
          ))}
        </ToastViewport>
      )}
      {view === "update-announcement" && notice && (
        <UpdateAnnouncement
          version="1.7.20"
          locale={locale}
          onClose={() => setNotice(false)}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);

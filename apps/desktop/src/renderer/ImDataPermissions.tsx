import { useState } from "react";
import {
  IM_SECURITY_VERSION,
  imPathWithinScope,
  type ExecutionGrant,
  type ImDataScope,
  type ImScopeEntry,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Checkbox, Select } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";

export function ImDataPermissions({
  grant,
  onChange,
  t,
  audiences,
  disabled,
}: {
  grant: ExecutionGrant;
  onChange: (security: NonNullable<ExecutionGrant["security"]>) => void;
  t: (cn: string, en: string) => string;
  audiences: Array<{ value: string; label: string; revision?: string }>;
  disabled: boolean;
}) {
  const [selectedAudience, setAudience] = useState("owner");
  const audience =
    selectedAudience === "owner" ||
    audiences.some((a) => a.value === selectedAudience)
      ? selectedAudience
      : "owner";
  const [entries, setEntries] = useState<Record<string, ImScopeEntry[]>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const scope = grant.security?.scopes.find((s) => s.audience === audience) ?? {
    audience,
    readPaths: [],
    writePaths: [],
  };
  const confirmed =
    !!grant.security?.confirmedAt &&
    grant.security.scopes.every(
      (s) =>
        s.audience === "owner" ||
        s.spaceRevision ===
          audiences.find((a) => a.value === s.audience)?.revision,
    );
  function change(next: ImDataScope) {
    onChange({
      version: IM_SECURITY_VERSION,
      revision: grant.security?.revision ?? "draft",
      confirmedAt: 0,
      scopes: [
        ...(grant.security?.scopes.filter((s) => s.audience !== audience) ??
          []),
        {
          ...next,
          filePaths: next.readPaths.filter(
            (path) =>
              Object.values(entries)
                .flat()
                .find((e) => e.path === path)?.directory === false ||
              scope.filePaths?.includes(path),
          ),
          ...(audiences.find((a) => a.value === audience)?.revision
            ? {
                spaceRevision: audiences.find((a) => a.value === audience)!
                  .revision!,
              }
            : {}),
        },
      ],
    });
  }
  async function expand(path: string) {
    if (entries[path]) {
      setEntries((old) => {
        const next = { ...old };
        delete next[path];
        return next;
      });
      return;
    }
    setPending(true);
    setError("");
    try {
      const values = (await window.artemis.manageIm({
        action: "scope-entries",
        projectId: grant.projectId,
        path,
      })) as ImScopeEntry[];
      setEntries((old) => ({ ...old, [path]: values }));
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  function renderEntries(path: string): React.ReactNode {
    return (
      <ul>
        {(entries[path] ?? []).map((entry) => (
          <li key={entry.path}>
            <span>{entry.path}</span>
            {entry.protected ? (
              <span> · {t("受保护", "Protected")}</span>
            ) : (
              <>
                {entry.directory ? (
                  <Button
                    size="compact"
                    disabled={pending || disabled}
                    aria-expanded={!!entries[entry.path]}
                    onClick={() => void expand(entry.path)}
                  >
                    {entries[entry.path]
                      ? t("收起", "Collapse")
                      : t("展开", "Expand")}
                  </Button>
                ) : null}
                <Checkbox
                  label={`${t("可处理", "Read")} ${entry.path}`}
                  checked={imPathWithinScope(entry.path, scope.readPaths)}
                  disabled={
                    disabled ||
                    scope.readPaths.some(
                      (p) =>
                        p !== entry.path && imPathWithinScope(entry.path, [p]),
                    )
                  }
                  onCheckedChange={(checked) =>
                    change({
                      ...scope,
                      readPaths: checked
                        ? [...scope.readPaths, entry.path]
                        : scope.readPaths.filter(
                            (p) => !imPathWithinScope(p, [entry.path]),
                          ),
                      writePaths: checked
                        ? scope.writePaths
                        : scope.writePaths.filter(
                            (p) => !imPathWithinScope(p, [entry.path]),
                          ),
                    })
                  }
                />
                <Checkbox
                  label={`${t("可修改", "Write")} ${entry.path}`}
                  checked={imPathWithinScope(entry.path, scope.writePaths)}
                  disabled={
                    disabled ||
                    !imPathWithinScope(entry.path, scope.readPaths) ||
                    scope.writePaths.some(
                      (p) =>
                        p !== entry.path && imPathWithinScope(entry.path, [p]),
                    )
                  }
                  onCheckedChange={(checked) =>
                    change({
                      ...scope,
                      writePaths: checked
                        ? [...scope.writePaths, entry.path]
                        : scope.writePaths.filter(
                            (p) => !imPathWithinScope(p, [entry.path]),
                          ),
                    })
                  }
                />
              </>
            )}
            {entry.directory && entries[entry.path]
              ? renderEntries(entry.path)
              : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <fieldset className="im-security-scope" disabled={disabled}>
      <legend>{t("数据与分享范围", "Data and sharing scope")}</legend>
      <Select
        labelVisibility="visible"
        label={t("分享给谁", "Audience")}
        value={audience}
        onValueChange={setAudience}
        options={[
          { value: "owner", label: t("主人单聊", "Owner direct chat") },
          ...audiences,
        ]}
      />
      <p>
        {t(
          "所选文件可用于向该会话的全部成员自动回复。目录包含未来新增内容；凭据与执行控制文件始终受保护。",
          "Selected data may be used in automatic replies to every member of this audience. Directories include future contents; credentials and execution configuration remain protected.",
        )}
      </p>
      <p>
        {t("可处理的文件：", "Readable: ")}
        {scope.readPaths.join(", ") || t("尚未选择", "None selected")}
      </p>
      <p>
        {t("可修改的文件：", "Writable: ")}
        {scope.writePaths.join(", ") || t("无", "None")}
      </p>
      <Button
        size="compact"
        disabled={pending || disabled}
        onClick={() => void expand("")}
      >
        {entries[""]
          ? t("收起目录", "Collapse files")
          : t("选择目录或文件", "Choose files or directories")}
      </Button>
      <Button
        size="compact"
        disabled={disabled}
        onClick={() => change({ ...scope, readPaths: [], writePaths: [] })}
      >
        {t("清除此范围", "Clear this scope")}
      </Button>
      {entries[""] ? renderEntries("") : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      {!confirmed ? (
        <InlineNotice tone="warning">
          {t(
            "需要确认数据与分享范围；保存确认前不会启动远程任务。",
            "Confirm the data and audience scopes before remote work can start.",
          )}
        </InlineNotice>
      ) : null}
      {(grant.security?.scopes ?? []).map((s) => (
        <p key={s.audience}>
          {audiences.find((a) => a.value === s.audience)?.label ??
            t("主人单聊", "Owner direct chat")}{" "}
          · {t("可处理", "Read")}: {s.readPaths.join(", ") || "—"} ·{" "}
          {t("可修改", "Write")}: {s.writePaths.join(", ") || "—"}
        </p>
      ))}
      <Checkbox
        label={t(
          "我确认以上文件范围与全部分享对象，保存后生效",
          "I confirm the file scopes and all recipients; apply when saved",
        )}
        checked={confirmed}
        disabled={disabled || !grant.security?.scopes.length}
        onCheckedChange={(checked) => {
          if (grant.security)
            onChange({
              ...grant.security,
              confirmedAt: checked ? Date.now() : 0,
              scopes: grant.security.scopes.map((s) => ({
                ...s,
                ...(audiences.find((a) => a.value === s.audience)?.revision
                  ? {
                      spaceRevision: audiences.find(
                        (a) => a.value === s.audience,
                      )!.revision!,
                    }
                  : {}),
              })),
            });
        }}
      />
    </fieldset>
  );
}

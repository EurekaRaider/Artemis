import { useEffect, useState, type ReactNode } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import type { ImScopeEntry } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { Checkbox } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import type { ImTranslate } from "./ImNavigation";

export type GroupPathSelection = {
  readPaths: string[];
  writePaths: string[];
  filePaths: string[];
};
const within = (path: string, root: string) =>
  path === root || path.startsWith(`${root}/`);

// Removing a descendant of a selected directory narrows that directory into
// its visible siblings. It never replaces an empty selection with a wildcard.
function togglePath(
  paths: string[],
  path: string,
  checked: boolean,
  entries: Record<string, ImScopeEntry[]>,
): string[] {
  if (checked)
    return [...paths.filter((p) => !within(p, path) && !within(path, p)), path];
  function subtract(root: string): string[] {
    if (within(root, path)) return [];
    if (!within(path, root)) return [root];
    return (entries[root] ?? [])
      .filter((e) => !e.protected)
      .flatMap((e) => subtract(e.path));
  }
  return paths.flatMap(subtract);
}

export function ImGroupPathTree({
  projectId,
  value,
  onChange,
  disabled,
  t,
}: {
  projectId: string;
  value: GroupPathSelection;
  onChange(value: GroupPathSelection): void;
  disabled: boolean;
  t: ImTranslate;
}) {
  const [entries, setEntries] = useState<Record<string, ImScopeEntry[]>>({});
  const [expanded, setExpanded] = useState<string[]>([""]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setPending(true);
    setError("");
    void window.artemis
      .manageIm({ action: "scope-entries", projectId, path: "" })
      .then((result) => {
        if (active) setEntries({ "": result as ImScopeEntry[] });
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, reload]);
  async function expand(path: string) {
    if (expanded.includes(path)) {
      setExpanded((old) => old.filter((p) => p !== path));
      return;
    }
    if (!entries[path]) {
      setPending(true);
      setError("");
      try {
        const result = await window.artemis.manageIm({
          action: "scope-entries",
          projectId,
          path,
        });
        setEntries((old) => ({ ...old, [path]: result as ImScopeEntry[] }));
      } catch (e) {
        setError(String(e));
        return;
      } finally {
        setPending(false);
      }
    }
    setExpanded((old) => [...old, path]);
  }
  function change(readPaths: string[], writePaths: string[]) {
    const files = new Set(
      Object.values(entries)
        .flat()
        .filter((e) => !e.directory)
        .map((e) => e.path),
    );
    onChange({
      readPaths,
      writePaths,
      filePaths: readPaths.filter((p) => files.has(p)),
    });
  }
  function toggle(
    path: string,
    permission: "readPaths" | "writePaths",
    checked: boolean,
  ) {
    if (permission === "readPaths") {
      const read = togglePath(value.readPaths, path, checked, entries);
      change(
        read,
        checked
          ? value.writePaths
          : togglePath(value.writePaths, path, false, entries),
      );
    } else {
      change(
        checked && !value.readPaths.some((p) => within(path, p))
          ? togglePath(value.readPaths, path, true, entries)
          : value.readPaths,
        togglePath(value.writePaths, path, checked, entries),
      );
    }
  }
  const roots = (entries[""] ?? [])
    .filter((e) => !e.protected)
    .map((e) => e.path);
  function renderEntries(parent: string): ReactNode {
    return (
      <ul className="im-scope-list">
        {(entries[parent] ?? []).map((entry) => (
          <li key={entry.path}>
            <div className="im-scope-row">
              <div className="im-scope-name" title={entry.path}>
                {entry.directory && !entry.protected ? (
                  <IconButton
                    className="im-scope-disclosure"
                    size="compact"
                    variant="quiet"
                    icon={<CaretRightIcon aria-hidden="true" />}
                    disabled={disabled || pending}
                    label={`${expanded.includes(entry.path) ? t("收起", "Collapse") : t("展开", "Expand")} ${entry.path}`}
                    aria-expanded={expanded.includes(entry.path)}
                    onClick={() => void expand(entry.path)}
                  />
                ) : (
                  <span className="im-scope-indent" aria-hidden="true" />
                )}
                <span>{entry.path.split("/").at(-1)}</span>
              </div>
              {entry.protected ? (
                <span className="im-scope-protected">
                  {t("受保护", "Protected")}
                </span>
              ) : (
                (["readPaths", "writePaths"] as const).map((permission) => {
                  const checked = value[permission].some((p) =>
                    within(entry.path, p),
                  );
                  const partial =
                    !checked &&
                    value[permission].some((p) => within(p, entry.path));
                  return (
                    <Checkbox
                      key={permission}
                      className="im-scope-check"
                      label={`${permission === "readPaths" ? t("读取/分享", "Read/share") : t("修改", "Write")} ${entry.path}`}
                      labelVisibility="hidden"
                      checked={checked}
                      indeterminate={partial}
                      disabled={disabled || pending}
                      onCheckedChange={(next) =>
                        toggle(entry.path, permission, next)
                      }
                    />
                  );
                })
              )}
            </div>
            {entry.directory && expanded.includes(entry.path)
              ? renderEntries(entry.path)
              : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <fieldset className="im-security-scope" disabled={disabled || pending}>
      <legend>{t("群文件权限", "Group file permissions")}</legend>
      <p>
        {t(
          "勾选文件可单独授权，勾选目录包含其全部内容及未来新增文件。修改会同时勾选读取/分享；受保护文件始终排除。",
          "Select individual files or entire directories, including future contents. Write also selects read/share; protected files are always excluded.",
        )}
      </p>
      <div className="im-scope-actions">
        <Button
          size="compact"
          disabled={disabled || pending || !roots.length}
          onClick={() => change(roots, value.writePaths)}
        >
          {t("全选读取/分享", "Select all read/share")}
        </Button>
        <Button
          size="compact"
          disabled={disabled || pending || !roots.length}
          onClick={() => change(roots, roots)}
        >
          {t("全选修改", "Select all write")}
        </Button>
        <Button
          size="compact"
          disabled={disabled || pending}
          onClick={() => change(value.readPaths, [])}
        >
          {t("清空修改", "Clear write")}
        </Button>
        <Button
          size="compact"
          disabled={disabled || pending}
          onClick={() => change([], [])}
        >
          {t("清空全部", "Clear all")}
        </Button>
      </div>
      {pending ? (
        <p role="status">{t("正在加载目录…", "Loading files…")}</p>
      ) : null}
      {error ? (
        <InlineNotice tone="danger">
          {error}
          <Button size="compact" onClick={() => setReload((n) => n + 1)}>
            {t("重试", "Retry")}
          </Button>
        </InlineNotice>
      ) : null}
      {entries[""] ? (
        <div className="im-scope-tree">
          <div className="im-scope-row im-scope-heading" aria-hidden="true">
            <span>{t("目录或文件", "Directory or file")}</span>
            <span>{t("读取/分享", "Read/share")}</span>
            <span>{t("修改", "Write")}</span>
          </div>
          {renderEntries("")}
          {!roots.length ? (
            <p>{t("没有可授权的文件。", "No files available to authorize.")}</p>
          ) : null}
        </div>
      ) : null}
      <p>
        {t(
          `已选 ${value.readPaths.length} 个读取/分享范围，${value.writePaths.length} 个修改范围。至少选择一个读取范围才能启用群聊；修改仍受项目操作权限限制。`,
          `${value.readPaths.length} read/share scopes, ${value.writePaths.length} write scopes selected. Select a readable scope to enable the group; project policy still applies to writes.`,
        )}
      </p>
    </fieldset>
  );
}

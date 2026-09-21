import { type UiTranslate } from "../shared/ui-text.js";
import { useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import {
  IM_SECURITY_VERSION,
  imPathWithinScope,
  imScopeCanWrite,
  imScopeConfirmation,
  type ExecutionGrant,
  type ImDataScope,
  type ImScopeEntry,
} from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { Checkbox, Select } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";

export function ImDataPermissions({
  grant,
  onChange,
  t,
  audiences,
  disabled,
  initialAudience = "owner",
  showAudienceSelector = true,
  draftMode = false,
}: {
  grant: ExecutionGrant;
  onChange: (security: NonNullable<ExecutionGrant["security"]>) => void;
  t: UiTranslate;
  audiences: Array<{ value: string; label: string; revision?: string }>;
  disabled: boolean;
  initialAudience?: string | undefined;
  showAudienceSelector?: boolean;
  draftMode?: boolean;
}) {
  const [selectedAudience, setAudience] = useState(initialAudience);
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
  const wholeProject =
    scope.readPaths.length === 0 && scope.readMode !== "selected";
  const audienceRevision = audiences.find(
    (a) => a.value === audience,
  )?.revision;
  const confirmed =
    !!imScopeConfirmation(grant.security, scope) &&
    (audience === "owner" ||
      (!!audienceRevision && scope.spaceRevision === audienceRevision));
  function updateScopes(scopes: ImDataScope[]) {
    onChange({
      version: IM_SECURITY_VERSION,
      revision: grant.security?.revision ?? "draft",
      confirmedAt: Math.max(0, ...scopes.map((s) => s.confirmedAt ?? 0)),
      scopes,
    });
  }
  const otherScopes = (grant.security?.scopes ?? [])
    .filter((s) => s.audience !== audience)
    .map((s) => ({
      ...s,
      confirmedAt: imScopeConfirmation(grant.security, s),
    }));
  const unavailableScopes = (grant.security?.scopes ?? []).filter(
    (s) =>
      s.audience !== "owner" &&
      !audiences.find((a) => a.value === s.audience)?.revision,
  );
  function change(
    next: ImDataScope,
    knownEntries = Object.values(entries).flat(),
    reset = false,
  ) {
    if (!draftMode && !reset && next.readPaths.length === 0) {
      setError(t("ImDataPermissions.message1"));
      return;
    }
    setError("");
    updateScopes([
      ...otherScopes,
      {
        ...next,
        confirmedAt: 0,
        readMode: reset ? "project" : "selected",
        filePaths: [...new Set([...next.readPaths, ...next.writePaths])].filter(
          (path) =>
            knownEntries.find((e) => e.path === path)?.directory === false ||
            scope.filePaths?.includes(path),
        ),
        ...(audienceRevision ? { spaceRevision: audienceRevision } : {}),
      },
    ]);
  }
  function selectAll(write: boolean) {
    change(
      {
        ...scope,
        readPaths: [],
        writePaths: [],
        writeMode: write ? "project" : "selected",
      },
      undefined,
      true,
    );
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
      <ul className="im-scope-list">
        {(entries[path] ?? []).map((entry) => (
          <li key={entry.path}>
            <div className="im-scope-row">
              <div className="im-scope-name" title={entry.path}>
                {entry.directory && !entry.protected ? (
                  <IconButton
                    className="im-scope-disclosure"
                    size="compact"
                    variant="quiet"
                    icon={<CaretRightIcon aria-hidden="true" />}
                    disabled={pending || disabled}
                    label={`${entries[entry.path] ? t("App_disclosureLabels.collapse") : t("App_disclosureLabels.expand")} ${entry.path}`}
                    aria-expanded={!!entries[entry.path]}
                    onClick={() => void expand(entry.path)}
                  />
                ) : (
                  <span className="im-scope-indent" aria-hidden="true" />
                )}
                <span>{entry.path.split("/").at(-1)}</span>
              </div>
              {entry.protected ? (
                <span className="im-scope-protected">
                  {t("ImDataPermissions.message6")}
                </span>
              ) : (
                <>
                  <Checkbox
                    className="im-scope-check"
                    label={`${t("ImDataPermissions.message4")} ${entry.path}`}
                    labelVisibility="hidden"
                    checked={
                      wholeProject ||
                      imPathWithinScope(entry.path, scope.readPaths)
                    }
                    disabled={
                      disabled ||
                      (wholeProject && path !== "") ||
                      scope.readPaths.some(
                        (p) =>
                          p !== entry.path &&
                          imPathWithinScope(entry.path, [p]),
                      )
                    }
                    onCheckedChange={(checked) => {
                      if (wholeProject) {
                        // 默认=整个项目可读；首次取消勾选收窄为根级枚举。
                        if (checked) return;
                        const rootEntries = entries[""] ?? [];
                        const paths = rootEntries
                          .filter((e) => !e.protected && e.path !== entry.path)
                          .map((e) => e.path);
                        change(
                          {
                            ...scope,
                            writeMode: "selected",
                            readPaths: paths,
                            writePaths: scope.writePaths.filter((p) =>
                              imPathWithinScope(p, paths),
                            ),
                          },
                          rootEntries,
                        );
                        return;
                      }
                      change({
                        ...scope,
                        writeMode: "selected",
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
                      });
                    }}
                  />
                  <Checkbox
                    className="im-scope-check"
                    label={`${t("ImDataPermissions.message5")} ${entry.path}`}
                    labelVisibility="hidden"
                    checked={
                      grant.mode === "execute" &&
                      imScopeCanWrite(scope, entry.path)
                    }
                    disabled={
                      disabled ||
                      grant.mode !== "execute" ||
                      (scope.readMode === "selected" &&
                        !scope.readPaths.length) ||
                      (scope.writeMode === "project" && path !== "") ||
                      (scope.readPaths.length > 0 &&
                        !imPathWithinScope(entry.path, scope.readPaths)) ||
                      scope.writePaths.some(
                        (p) =>
                          p !== entry.path &&
                          imPathWithinScope(entry.path, [p]),
                      )
                    }
                    onCheckedChange={(checked) =>
                      change(
                        {
                          ...scope,
                          writeMode: "selected",
                          writePaths: checked
                            ? [...scope.writePaths, entry.path]
                            : scope.writeMode === "project"
                              ? (entries[""] ?? [])
                                  .filter(
                                    (e) =>
                                      !e.protected && e.path !== entry.path,
                                  )
                                  .map((e) => e.path)
                              : scope.writePaths.filter(
                                  (p) => !imPathWithinScope(p, [entry.path]),
                                ),
                        },
                        undefined,
                        wholeProject,
                      )
                    }
                  />
                </>
              )}
            </div>
            {entry.directory && entries[entry.path]
              ? renderEntries(entry.path)
              : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <fieldset className="im-security-scope" disabled={disabled || pending}>
      <legend>{t("ImDataPermissions.message7")}</legend>
      {showAudienceSelector && (
        <Select
          labelVisibility="visible"
          label={t("ImDataPermissions.message8")}
          value={audience}
          onValueChange={setAudience}
          options={[
            {
              value: "owner",
              label: t("ImDataPermissions.message9"),
            },
            ...audiences,
          ]}
        />
      )}
      <p>{t("ImDataPermissions.message10")}</p>
      {draftMode && (
        <Select
          label={t("GroupAuthorization.readScope")}
          labelVisibility="visible"
          value={wholeProject ? "project" : "selected"}
          options={[
            { value: "project", label: t("ImDataPermissions.message13") },
            { value: "selected", label: t("ImDataPermissions.selectedOnly") },
          ]}
          onValueChange={(value) => {
            if (value === "project") selectAll(false);
            else
              change({
                ...scope,
                readMode: "selected",
                readPaths: [],
                writePaths: [],
                writeMode: "selected",
              });
          }}
        />
      )}
      {draftMode && !wholeProject && !scope.readPaths.length && (
        <InlineNotice tone="warning">
          {t("GroupAuthorization.emptySelection")}
        </InlineNotice>
      )}
      <p role="status">
        {t(
          scope.writeMode === "project"
            ? "ImDataPermissions.wholeProjectWrite"
            : wholeProject
              ? "ImDataPermissions.wholeProject"
              : "ImDataPermissions.selectedOnly",
        )}
      </p>
      <div className="im-scope-actions">
        <Button
          size="compact"
          disabled={pending || disabled}
          onClick={() => void expand("")}
        >
          {entries[""]
            ? t("ImDataPermissions.message12")
            : t("ImDataPermissions.message11")}
        </Button>
        <Button
          size="compact"
          disabled={pending || disabled}
          onClick={() => void selectAll(false)}
        >
          {t("ImDataPermissions.message13")}
        </Button>
        <Button
          size="compact"
          disabled={pending || disabled || grant.mode !== "execute"}
          onClick={() => void selectAll(true)}
        >
          {t("ImDataPermissions.message14")}
        </Button>
        <Button
          size="compact"
          disabled={disabled}
          onClick={() =>
            change(
              {
                ...scope,
                readPaths: [],
                writePaths: [],
                writeMode: "selected",
              },
              undefined,
              true,
            )
          }
        >
          {t("ImDataPermissions.message15")}
        </Button>
      </div>
      {entries[""] ? (
        <div className="im-scope-tree">
          <div className="im-scope-row im-scope-heading" aria-hidden="true">
            <span>{t("ImDataPermissions.message16")}</span>
            <span>{t("ImDataPermissions.message4")}</span>
            <span>{t("ImDataPermissions.message5")}</span>
          </div>
          {renderEntries("")}
        </div>
      ) : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
      {unavailableScopes.length > 0 ? (
        <InlineNotice tone="warning">
          {t("ImDataPermissions.unavailableAudiences")}{" "}
          {unavailableScopes
            .map(
              (s) =>
                audiences.find((a) => a.value === s.audience)?.label ??
                s.audience,
            )
            .join("、")}
          <Button
            size="compact"
            disabled={disabled || pending}
            onClick={() => {
              if (grant.security)
                updateScopes(
                  grant.security.scopes
                    .filter((s) => !unavailableScopes.includes(s))
                    .map((s) => ({
                      ...s,
                      confirmedAt: imScopeConfirmation(grant.security, s),
                    })),
                );
            }}
          >
            {t("ImDataPermissions.removeUnavailableScopes")}
          </Button>
        </InlineNotice>
      ) : null}
      {!draftMode && !confirmed ? (
        <InlineNotice tone="warning">
          {t("ImDataPermissions.message19")}
        </InlineNotice>
      ) : null}
      {!draftMode && (
        <Checkbox
          label={t("ImDataPermissions.message20")}
          checked={confirmed}
          disabled={disabled || (audience !== "owner" && !audienceRevision)}
          onCheckedChange={(checked) =>
            updateScopes([
              ...otherScopes,
              {
                ...scope,
                confirmedAt: checked ? Date.now() : 0,
                ...(audienceRevision
                  ? { spaceRevision: audienceRevision }
                  : {}),
              },
            ])
          }
        />
      )}
    </fieldset>
  );
}

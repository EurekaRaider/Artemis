import { useLayoutEffect, useRef, useState } from "react";
import {
  imConversationKey,
  imProjectPolicy,
  imScopeConfirmation,
  imAuthorizationCommandSchema,
  type AppLocale,
  type ImAuthorizationOperation,
  type ImConnectionStatus,
  type ImStatus,
  type Project,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Checkbox, Select, TextField } from "@artemis/ui/forms";
import { Dialog, InlineNotice } from "@artemis/ui/feedback";
import { uiTranslator } from "../shared/ui-text";
import { ImDataPermissions } from "./ImDataPermissions";
import { imNativeGroupChoices } from "./ImNativeGroups";
import {
  authorizationDraftConflict,
  createAuthorizationDraft,
  draftAuthorizationCommand,
  type AuthorizationDraft,
  type AuthorizationTarget,
} from "./im-authorization-draft";
import "./group-collaboration.css";

type Status = ImStatus & { spaces?: unknown[]; connections?: unknown[] };
export function GroupCollaborationPanel({
  status,
  diagnostics,
  projects,
  locale,
  refresh,
  onClose,
  onOpenThread,
  returnFocusRef,
}: {
  status: Status;
  diagnostics: unknown;
  projects: Project[];
  locale: AppLocale;
  refresh(): Promise<void>;
  onClose(): void;
  onOpenThread?: ((id: string) => Promise<void>) | undefined;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const t = uiTranslator(locale);
  const [view, setView] = useState<"group" | "project">("group");
  const [selected, setSelected] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<AuthorizationDraft>();
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const [operation, setOperation] = useState<ImAuthorizationOperation>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const sending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const groups = imNativeGroupChoices(
    diagnostics,
    status.spaces ?? [],
    status.settings.deviceId,
    t,
  );
  const key = (group: AuthorizationTarget) =>
    imConversationKey(group.conversation);
  const current = groups.find((g) => key(g) === selected);
  const saved = current?.saved;
  const grant = status.settings.grants.find(
    (g) => g.projectId === saved?.nativeGroup?.projectId,
  );
  const scope = grant?.security?.scopes.find(
    (s) => s.audience === current?.value,
  );
  const command = draft && draftAuthorizationCommand(draft);
  const currentDraftTarget =
    draft?.target && groups.find((g) => key(g) === key(draft.target!));
  const conflict =
    !!draft &&
    authorizationDraftConflict(draft, status.settings, currentDraftTarget);
  const pending =
    operation ??
    status.authorizationOperations?.find(
      (op) => op.state !== "complete" && op.state !== "superseded",
    );
  const locked =
    submitting ||
    (!!pending &&
      pending.state !== "complete" &&
      draft?.supersedes !== pending.command.operationId);
  const active = draft?.grant;
  const policyChanged =
    !!draft?.editPolicy &&
    JSON.stringify(imProjectPolicy(draft.grant)) !==
      JSON.stringify(
        draft.baseline.grants.find((g) => g.projectId === draft.projectId) &&
          imProjectPolicy(
            draft.baseline.grants.find((g) => g.projectId === draft.projectId)!,
          ),
      );
  const affected = draft
    ? groups.filter((g) => g.saved?.nativeGroup?.projectId === draft.projectId)
    : [];
  const expiration = (value: number) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "full",
      timeStyle: "long",
    }).format(value);
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (body.current) body.current.scrollTop = 0;
  }, [draft?.step, !!draft, !!discard, pending?.state]);
  useLayoutEffect(() => {
    if (conflict)
      setDraft((previous) =>
        previous?.confirmation ? { ...previous, confirmation: "" } : previous,
      );
  }, [conflict]);
  function navigate(action: () => void) {
    if (draft?.dirty && !pending && !submitting) setDiscard(() => action);
    else action();
  }
  function change(patch: Partial<AuthorizationDraft>) {
    setDraft(
      (previous) =>
        previous && { ...previous, ...patch, confirmation: "", dirty: true },
    );
  }
  function begin(
    target: AuthorizationTarget | undefined,
    projectId: string,
    intent: AuthorizationDraft["intent"],
    entry: AuthorizationDraft["entry"] = view,
  ) {
    setError("");
    setOperation(undefined);
    setDraft(
      createAuthorizationDraft(
        status.settings,
        target,
        projectId,
        intent,
        entry,
      ),
    );
  }
  async function submit(retry?: ImAuthorizationOperation) {
    if (
      sending.current ||
      (!retry &&
        (!command ||
          conflict ||
          draft?.confirmation !== command.confirmationFingerprint))
    )
      return;
    sending.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = (await window.artemis.manageIm(
        retry
          ? {
              action: "retry-group-authorization",
              operationId: retry.command.operationId,
            }
          : { action: "authorize-group", command: command! },
      )) as ImAuthorizationOperation;
      setOperation(result);
      await refresh();
      if (result.state === "complete") {
        setSelected(imConversationKey(result.command.conversation));
        setDraft(undefined);
        setOperation(undefined);
      }
    } catch (e) {
      // Preserve operation ID after a lost IPC reply. Query/retry it before any new command.
      setError(String(e));
      if (command) {
        const latest = await window.artemis
          .getImStatus()
          .catch(() => undefined);
        const recorded = latest?.authorizationOperations?.find(
          (op) => op.command.operationId === command.operationId,
        );
        if (recorded) setOperation(recorded);
      }
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  }
  function policyFields() {
    if (!draft || !active) return null;
    const edit = (patch: Partial<typeof active>) =>
      change({ grant: { ...active, ...patch } });
    return (
      <div className="im-field-stack">
        <Select
          label={t("GroupAuthorization.mode")}
          labelVisibility="visible"
          value={active.mode}
          disabled={locked}
          options={[
            { value: "plan", label: t("ImSettingsPanel.message132") },
            { value: "review", label: t("ImSettingsPanel.message134") },
            { value: "execute", label: t("ImSettingsPanel.message136") },
          ]}
          onValueChange={(value) => edit({ mode: value as typeof active.mode })}
        />
        <Select
          label={t("ImSettingsPanel.message143")}
          labelVisibility="visible"
          disabled={locked}
          value={active.approval}
          options={[
            { value: "ask", label: t("ImSettingsPanel.message144") },
            { value: "automatic", label: t("ImSettingsPanel.message145") },
          ]}
          onValueChange={(value) =>
            edit({ approval: value as typeof active.approval })
          }
        />
        {active.mode === "execute" && (
          <>
            <Checkbox
              label={t("ImSettingsPanel.message147")}
              disabled={locked}
              checked={active.shell}
              onCheckedChange={(shell) => edit({ shell })}
            />
            <Checkbox
              label={t("ImSettingsPanel.message148")}
              disabled={locked}
              checked={active.network}
              onCheckedChange={(network) => edit({ network })}
            />
          </>
        )}
        <label>
          <span>{t("GroupAuthorization.expiration")}</span>
          <input
            aria-label={t("GroupAuthorization.expiration")}
            type="datetime-local"
            disabled={locked}
            value={new Date(
              active.expiresAt -
                new Date(active.expiresAt).getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16)}
            onChange={(event) => {
              const date = new Date(event.target.value).getTime();
              if (Number.isFinite(date)) edit({ expiresAt: date });
            }}
          />
        </label>
        <p>{expiration(active.expiresAt)}</p>
      </div>
    );
  }
  function policySummary(value: typeof grant) {
    return (
      value && (
        <p>
          {t(
            value.mode === "plan"
              ? "ImSettingsPanel.message132"
              : value.mode === "review"
                ? "ImSettingsPanel.message134"
                : "ImSettingsPanel.message136",
          )}{" "}
          ·{" "}
          {t(
            value.approval === "ask"
              ? "ImSettingsPanel.message144"
              : "ImSettingsPanel.message145",
          )}{" "}
          · {expiration(value.expiresAt)}
        </p>
      )
    );
  }
  const connection = (
    status.connections as ImConnectionStatus[] | undefined
  )?.find((c) => c.id === current?.conversation.connectionId);
  const state = !saved
    ? "unbound"
    : !saved.nativeGroup?.enabled
      ? "paused"
      : !status.settings.enabled
        ? "saved"
        : connection?.state !== "connected"
          ? "connecting"
          : !grant || !scope || grant.expiresAt <= Date.now()
            ? "review"
            : grant.mode !== "execute"
              ? "readOnly"
              : !imScopeConfirmation(grant.security, scope)
                ? "writePending"
                : "executable";
  const task = status.remoteTasks?.find(
    (task) =>
      !task.parentThreadId &&
      task.currentGroupEntry !== false &&
      task.group?.spaceId === saved?.id,
  );
  return (
    <Dialog
      open
      dir={locale === "ar" ? "rtl" : "ltr"}
      className="im-group-dialog"
      label={t("GroupAuthorization.title")}
      returnFocusRef={returnFocusRef}
      onOpenChange={(open) => {
        if (!open) navigate(onClose);
      }}
    >
      <header className="im-group-header">
        <h2 ref={heading} tabIndex={-1}>
          {t("GroupAuthorization.title")}
        </h2>
        <Button variant="quiet" onClick={() => navigate(onClose)}>
          {t("GroupAuthorization.close")}
        </Button>
      </header>
      <div
        ref={body}
        className="im-group-body"
        dir={locale === "ar" ? "rtl" : "ltr"}
      >
        {discard ? (
          <div className="im-field-stack">
            <p>{t("GroupAuthorization.discardPrompt")}</p>
            <Button onClick={() => setDiscard(null)}>
              {t("GroupAuthorization.keepEditing")}
            </Button>
            <Button
              onClick={() => {
                const action = discard;
                setDiscard(null);
                action();
              }}
            >
              {t("GroupAuthorization.discard")}
            </Button>
          </div>
        ) : (
          <>
            {error && (
              <InlineNotice tone="danger" role="alert">
                {error}
              </InlineNotice>
            )}
            {!status.localGateway && (
              <InlineNotice tone="warning">
                {t("ImSettingsPanel.message164")}
              </InlineNotice>
            )}
            {status.authorizationVersion !== 1 && (
              <InlineNotice tone="warning">
                {t("GroupAuthorization.upgrade")}
              </InlineNotice>
            )}
            {pending && pending.state !== "complete" && (
              <section className="im-field-stack" aria-live="polite">
                <strong>{t("GroupAuthorization.pending")}</strong>
                <p>{pending.command.name}</p>
                {Object.entries(pending.phases).map(([phase, state]) => (
                  <p key={phase}>
                    {t(
                      `GroupAuthorization.${phase}` as "GroupAuthorization.binding",
                    )}{" "}
                    ·{" "}
                    {t(
                      `GroupAuthorization.phase_${state}` as "GroupAuthorization.phase_pending",
                    )}
                  </p>
                ))}
                {pending.error && (
                  <InlineNotice tone="warning">{pending.error}</InlineNotice>
                )}
                <p>{t("GroupAuthorization.closePending")}</p>
                <Button
                  disabled={submitting}
                  onClick={() => {
                    const target = groups.find(
                      (g) =>
                        imConversationKey(g.conversation) ===
                        imConversationKey(pending.command.conversation),
                    );
                    const next = createAuthorizationDraft(
                      status.settings,
                      target,
                      pending.command.projectId,
                      target?.saved
                        ? target.saved.nativeGroup?.projectId !==
                          pending.command.projectId
                          ? "rebind"
                          : "restore"
                        : "create",
                      "group",
                    );
                    setDraft({
                      ...next,
                      supersedes: pending.command.operationId,
                    });
                  }}
                >
                  {t("GroupAuthorization.reload")}
                </Button>
                <Button
                  disabled={submitting || pending.state === "conflict"}
                  onClick={() => void submit(pending)}
                >
                  {t("GroupAuthorization.retry")}
                </Button>
              </section>
            )}
            {!draft ? (
              <div className="im-group-management">
                <nav
                  className="im-field-stack"
                  aria-label={t("GroupAuthorization.directory")}
                >
                  <div className="im-group-actions">
                    <Button
                      aria-pressed={view === "group"}
                      onClick={() => setView("group")}
                    >
                      {t("GroupAuthorization.byGroup")}
                    </Button>
                    <Button
                      aria-pressed={view === "project"}
                      onClick={() => setView("project")}
                    >
                      {t("GroupAuthorization.byProject")}
                    </Button>
                  </div>
                  <TextField
                    label={t("GroupAuthorization.search")}
                    value={query}
                    onValueChange={setQuery}
                  />
                  <Button
                    onClick={() =>
                      void refresh().catch((e) => setError(String(e)))
                    }
                  >
                    {t("GroupAuthorization.refresh")}
                  </Button>
                  {view === "project" && (
                    <Select
                      label={t("GroupAuthorization.project")}
                      labelVisibility="visible"
                      value={projectFilter}
                      options={[
                        {
                          value: "",
                          label: t("GroupAuthorization.chooseProject"),
                        },
                        ...projects.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                      onValueChange={setProjectFilter}
                    />
                  )}
                  {view === "project" && projectFilter && (
                    <Button
                      disabled={
                        locked ||
                        status.authorizationVersion !== 1 ||
                        !status.localGateway
                      }
                      onClick={() =>
                        begin(undefined, projectFilter, "create", "project")
                      }
                    >
                      {t("GroupAuthorization.add")}
                    </Button>
                  )}
                  {groups
                    .filter(
                      (g) =>
                        g.label
                          .toLocaleLowerCase()
                          .includes(query.toLocaleLowerCase()) &&
                        (view === "group" ||
                          !projectFilter ||
                          g.saved?.nativeGroup?.projectId === projectFilter),
                    )
                    .map((group) => (
                      <Button
                        key={key(group)}
                        aria-pressed={selected === key(group)}
                        onClick={() => setSelected(key(group))}
                      >
                        <span className="im-group-row-copy">
                          <strong>
                            {group.label.replace(
                              ` · ${group.conversation.connectionId} · ${group.conversation.id}`,
                              "",
                            )}
                          </strong>
                          <span className="im-group-identity">
                            {group.platform ?? group.owner?.channel} ·{" "}
                            {group.conversation.connectionId} ·{" "}
                            {group.conversation.id}
                          </span>
                        </span>
                      </Button>
                    ))}
                  {!groups.length && <p>{t("GroupAuthorization.noGroups")}</p>}
                  {query && (
                    <Button onClick={() => setQuery("")}>
                      {t("GroupAuthorization.clearSearch")}
                    </Button>
                  )}
                </nav>
                <section className="im-field-stack" aria-live="polite">
                  {current ? (
                    <>
                      <h3>{current.label}</h3>
                      <p>
                        {current.conversation.connectionId} ·{" "}
                        {current.conversation.id}
                      </p>
                      <strong>{t(`GroupAuthorization.${state}`)}</strong>
                      <p>
                        {projects.find((p) => p.id === grant?.projectId)?.name}
                      </p>
                      {policySummary(grant)}
                      {scope && (
                        <dl className="im-group-summary">
                          <dt>{t("GroupAuthorization.readScope")}</dt>
                          <dd>
                            {scope.readPaths.length
                              ? scope.readPaths.join(" · ")
                              : t("ImDataPermissions.message13")}
                          </dd>
                          <dt>{t("GroupAuthorization.writeScope")}</dt>
                          <dd>
                            {grant?.mode !== "execute"
                              ? t("GroupAuthorization.denied")
                              : scope.writeMode === "project"
                                ? t("ImDataPermissions.message14")
                                : scope.writePaths.join(" · ") ||
                                  t("GroupAuthorization.denied")}
                          </dd>
                        </dl>
                      )}
                      <p>{t("GroupAuthorization.rosterNotice")}</p>
                      {task && onOpenThread ? (
                        <Button
                          onClick={() => void onOpenThread(task.threadId)}
                        >
                          {t("ImNativeGroups.message9")}
                        </Button>
                      ) : (
                        <p>{t("GroupAuthorization.firstMessage")}</p>
                      )}
                      <Button
                        disabled={
                          locked ||
                          status.authorizationVersion !== 1 ||
                          !status.localGateway ||
                          !current.owner
                        }
                        onClick={() =>
                          begin(
                            current,
                            saved?.nativeGroup?.projectId ?? "",
                            !saved
                              ? "create"
                              : !saved.nativeGroup?.enabled
                                ? "restore"
                                : grant && grant.expiresAt <= Date.now()
                                  ? "renew"
                                  : "edit",
                            "group",
                          )
                        }
                      >
                        {t(
                          !saved
                            ? "GroupAuthorization.authorize"
                            : !saved.nativeGroup?.enabled
                              ? "GroupAuthorization.restore"
                              : grant && grant.expiresAt <= Date.now()
                                ? "GroupAuthorization.renew"
                                : "GroupAuthorization.edit",
                        )}
                      </Button>
                      {!current.owner && (
                        <InlineNotice tone="warning">
                          {t("GroupAuthorization.ownerRequired")}
                        </InlineNotice>
                      )}
                      {saved && (
                        <div className="im-group-actions">
                          <Button
                            disabled={locked}
                            onClick={() =>
                              begin(
                                current,
                                saved.nativeGroup!.projectId,
                                "rebind",
                                "group",
                              )
                            }
                          >
                            {t("GroupAuthorization.rebind")}
                          </Button>
                          <Button
                            disabled={locked}
                            onClick={() =>
                              begin(
                                current,
                                saved.nativeGroup!.projectId,
                                "renew",
                                "group",
                              )
                            }
                          >
                            {t("GroupAuthorization.renew")}
                          </Button>
                          {saved.nativeGroup?.enabled && (
                            <Button
                              disabled={locked}
                              onClick={() =>
                                begin(
                                  current,
                                  saved.nativeGroup!.projectId,
                                  "pause",
                                  "group",
                                )
                              }
                            >
                              {t("GroupAuthorization.pause")}
                            </Button>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p>{t("GroupAuthorization.chooseGroup")}</p>
                  )}
                </section>
              </div>
            ) : (
              <div className="im-field-stack">
                <ol
                  className="im-group-steps"
                  aria-label={t("GroupAuthorization.steps")}
                >
                  {["project", "permissions", "confirm"].map((step, index) => (
                    <li
                      key={step}
                      aria-current={
                        draft.step === index + 1 ? "step" : undefined
                      }
                    >
                      {index + 1}.{" "}
                      {t(
                        `GroupAuthorization.${step}` as "GroupAuthorization.project",
                      )}
                    </li>
                  ))}
                </ol>
                {draft.target && draft.step !== 3 && (
                  <p>
                    <strong>
                      {draft.target.name ?? draft.target.conversation.id}
                    </strong>{" "}
                    · {draft.target.conversation.connectionId} ·{" "}
                    {draft.target.owner?.userId}
                  </p>
                )}
                {conflict && (
                  <InlineNotice tone="warning" role="alert">
                    {t("GroupAuthorization.conflict")}
                    <Button
                      disabled={locked}
                      onClick={() =>
                        begin(
                          currentDraftTarget,
                          draft.projectId,
                          draft.intent,
                          draft.entry,
                        )
                      }
                    >
                      {t("GroupAuthorization.reload")}
                    </Button>
                  </InlineNotice>
                )}
                {draft.step === 1 && (
                  <>
                    {draft.entry === "project" && (
                      <Select
                        label={t("GroupAuthorization.group")}
                        labelVisibility="visible"
                        value={draft.target ? key(draft.target) : ""}
                        options={[
                          {
                            value: "",
                            label: t("GroupAuthorization.chooseGroup"),
                          },
                          ...groups.map((g) => ({
                            value: key(g),
                            label: `${g.label} · ${g.conversation.connectionId}`,
                          })),
                        ]}
                        onValueChange={(value) => {
                          const target = groups.find((g) => key(g) === value);
                          const next = createAuthorizationDraft(
                            status.settings,
                            target,
                            draft.projectId,
                            target?.saved ? "rebind" : "create",
                            draft.entry,
                          );
                          setDraft({ ...next, dirty: true });
                        }}
                      />
                    )}
                    <Select
                      label={t("GroupAuthorization.project")}
                      labelVisibility="visible"
                      value={draft.projectId}
                      disabled={draft.entry === "project"}
                      options={[
                        {
                          value: "",
                          label: t("GroupAuthorization.chooseProject"),
                        },
                        ...projects.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                      onValueChange={(value) =>
                        setDraft({
                          ...createAuthorizationDraft(
                            status.settings,
                            draft.target,
                            value,
                            draft.intent,
                            draft.entry,
                          ),
                          dirty: true,
                        })
                      }
                    />
                    {!projects.length && (
                      <p>{t("GroupAuthorization.noProjects")}</p>
                    )}
                    {!draft.target?.owner && (
                      <InlineNotice tone="warning">
                        {t("GroupAuthorization.ownerRequired")}
                      </InlineNotice>
                    )}
                    {draft.intent === "rebind" && (
                      <InlineNotice tone="warning">
                        {t("GroupAuthorization.rebindImpact", {
                          before:
                            projects.find(
                              (p) =>
                                p.id ===
                                draft.target?.saved?.nativeGroup?.projectId,
                            )?.name ?? "",
                          after:
                            projects.find((p) => p.id === draft.projectId)
                              ?.name ?? "",
                        })}
                      </InlineNotice>
                    )}
                  </>
                )}
                {draft.step === 2 && active && (
                  <>
                    <h3>{t("GroupAuthorization.sharedPolicy")}</h3>
                    {policySummary(active)}
                    {!draft.editPolicy ? (
                      <Button
                        disabled={locked}
                        onClick={() => change({ editPolicy: true })}
                      >
                        {t("GroupAuthorization.changePolicy")}
                      </Button>
                    ) : (
                      policyFields()
                    )}
                    {draft.intent !== "renew" && draft.intent !== "pause" && (
                      <ImDataPermissions
                        key={draft.projectId}
                        grant={active}
                        t={t}
                        disabled={locked}
                        audiences={[]}
                        draftMode
                        showAudienceSelector={false}
                        onChange={(security) =>
                          change({ grant: { ...active, security } })
                        }
                      />
                    )}
                  </>
                )}
                {draft.step === 3 && active && command && (
                  <>
                    <h3>
                      {t(
                        draft.intent === "pause"
                          ? "GroupAuthorization.pause"
                          : "GroupAuthorization.confirm",
                      )}
                    </h3>
                    <dl className="im-group-summary">
                      <dt>{t("GroupAuthorization.group")}</dt>
                      <dd>
                        {draft.target?.name ?? command.conversation.id} ·{" "}
                        {command.conversation.id}
                      </dd>
                      <dt>{t("GroupAuthorization.identity")}</dt>
                      <dd>
                        {command.owner.channel} · {command.owner.connectionId} ·{" "}
                        {command.owner.tenantId} · {command.owner.appId} ·{" "}
                        {command.owner.userId}
                      </dd>
                      <dt>{t("GroupAuthorization.project")}</dt>
                      <dd>
                        {projects.find((p) => p.id === command.projectId)?.name}
                      </dd>
                      <dt>{t("GroupAuthorization.sharedPolicy")}</dt>
                      <dd>
                        {policySummary(active)}
                        {active.mode === "execute"
                          ? `${t("ImSettingsPanel.message147")}: ${t(active.shell ? "GroupAuthorization.allowed" : "GroupAuthorization.denied")} · ${t("ImSettingsPanel.message148")}: ${t(active.network ? "GroupAuthorization.allowed" : "GroupAuthorization.denied")}`
                          : t("GroupAuthorization.readOnly")}
                      </dd>
                      <dt>{t("GroupAuthorization.readScope")}</dt>
                      <dd>
                        {command.scope.readMode === "selected" ||
                        command.scope.readPaths.length
                          ? command.scope.readPaths.join(" · ")
                          : t("ImDataPermissions.message13")}
                      </dd>
                      <dt>{t("GroupAuthorization.writeScope")}</dt>
                      <dd>
                        {active.mode !== "execute"
                          ? t("GroupAuthorization.denied")
                          : command.scope.writeMode === "project"
                            ? t("ImDataPermissions.message14")
                            : command.scope.writePaths.join(" · ") ||
                              t("GroupAuthorization.denied")}
                      </dd>
                    </dl>
                    <p>{t("GroupAuthorization.futureFiles")}</p>
                    <p>{t("GroupAuthorization.rosterNotice")}</p>
                    {policyChanged && affected.length > 0 && (
                      <InlineNotice tone="warning">
                        <p>{t("GroupAuthorization.policyImpact")}</p>
                        {affected.map((g) => (
                          <p key={key(g)}>
                            {g.label} · {g.conversation.connectionId}
                          </p>
                        ))}
                        {(() => {
                          const before = draft.baseline.grants.find(
                            (g) => g.projectId === draft.projectId,
                          );
                          return (
                            before && (
                              <div>
                                {policySummary(before)} →{" "}
                                {policySummary(active)}
                                <span>
                                  {t("ImSettingsPanel.message147")}:{" "}
                                  {t(
                                    before.shell
                                      ? "GroupAuthorization.allowed"
                                      : "GroupAuthorization.denied",
                                  )}{" "}
                                  →{" "}
                                  {t(
                                    active.shell
                                      ? "GroupAuthorization.allowed"
                                      : "GroupAuthorization.denied",
                                  )}{" "}
                                  · {t("ImSettingsPanel.message148")}:{" "}
                                  {t(
                                    before.network
                                      ? "GroupAuthorization.allowed"
                                      : "GroupAuthorization.denied",
                                  )}{" "}
                                  →{" "}
                                  {t(
                                    active.network
                                      ? "GroupAuthorization.allowed"
                                      : "GroupAuthorization.denied",
                                  )}
                                </span>
                              </div>
                            )
                          );
                        })()}
                      </InlineNotice>
                    )}
                    {!status.settings.enabled &&
                      command.enableService &&
                      groups.some((g) => g.saved?.nativeGroup?.enabled) && (
                        <InlineNotice tone="warning">
                          {t("GroupAuthorization.deviceImpact")}{" "}
                          {groups
                            .filter((g) => g.saved?.nativeGroup?.enabled)
                            .map((g) => g.label)
                            .join(" · ")}
                        </InlineNotice>
                      )}
                    {draft.intent === "rebind" && (
                      <InlineNotice tone="warning">
                        {t("GroupAuthorization.rebindImpact", {
                          before:
                            projects.find(
                              (p) =>
                                p.id ===
                                draft.target?.saved?.nativeGroup?.projectId,
                            )?.name ?? "",
                          after:
                            projects.find((p) => p.id === draft.projectId)
                              ?.name ?? "",
                        })}
                      </InlineNotice>
                    )}
                    <Checkbox
                      label={t("GroupAuthorization.confirmSharing")}
                      checked={
                        draft.confirmation === command.confirmationFingerprint
                      }
                      disabled={locked || conflict}
                      onCheckedChange={(checked) =>
                        setDraft({
                          ...draft,
                          confirmation: checked
                            ? command.confirmationFingerprint
                            : "",
                          dirty: true,
                        })
                      }
                    />
                  </>
                )}
                <footer className="im-group-actions">
                  <Button onClick={() => navigate(() => setDraft(undefined))}>
                    {t("GroupAuthorization.cancel")}
                  </Button>
                  {draft.step > 1 && (
                    <Button
                      disabled={locked}
                      onClick={() =>
                        change({ step: (draft.step - 1) as 1 | 2 })
                      }
                    >
                      {t("GroupAuthorization.back")}
                    </Button>
                  )}
                  {draft.step < 3 ? (
                    <Button
                      disabled={
                        locked ||
                        !command ||
                        conflict ||
                        !imAuthorizationCommandSchema.safeParse(command)
                          .success ||
                        (draft.intent !== "pause" &&
                          draft.grant.expiresAt <= Date.now())
                      }
                      onClick={() =>
                        change({ step: (draft.step + 1) as 2 | 3 })
                      }
                    >
                      {t("GroupAuthorization.next")}
                    </Button>
                  ) : (
                    <Button
                      disabled={
                        locked ||
                        conflict ||
                        !command ||
                        draft.confirmation !==
                          command.confirmationFingerprint ||
                        status.authorizationVersion !== 1 ||
                        !status.localGateway
                      }
                      onClick={() => void submit()}
                    >
                      {t("GroupAuthorization.submit")}
                    </Button>
                  )}
                </footer>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

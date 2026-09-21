import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  imConversationKey,
  imIdentityKey,
  imGroupRosterSchema,
  imProjectPolicy,
  imScopeConfirmation,
  imAuthorizationCommandSchema,
  type AppLocale,
  type ImAuthorizationOperation,
  type ImConnectionStatus,
  type ImStatus,
  type Project,
} from "@artemis/protocol";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  Check,
  ArrowsLeftRight,
  CaretRight,
  ChatCircleDots,
  FolderSimple,
  MagnifyingGlass,
  Pause,
  Plus,
  ShieldCheck,
  UsersThree,
  User,
  X,
} from "@phosphor-icons/react";
import groupChannelIcon from "./assets/im-group-icon.svg";
import feishuChannelIcon from "./assets/feishu-channel.png";
import slackChannelIcon from "./assets/slack-channel.svg";
import { ArtemisIcon } from "@artemis/ui/icons";
import { Button, IconButton } from "@artemis/ui/actions";
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
import { imGroupMemberStatus } from "./im-group-member-status";

type GroupChoice = ReturnType<typeof imNativeGroupChoices>[number];
function GroupLogo({ group }: { group: GroupChoice }) {
  const platform = group.platform ?? group.owner?.channel;
  return (
    <span className="im-group-logo" title={platform}>
      <img
        src={
          platform === "slack"
            ? slackChannelIcon
            : platform === "feishu" || platform === "lark"
              ? feishuChannelIcon
              : groupChannelIcon
        }
        alt={
          platform === "slack"
            ? "Slack"
            : platform === "lark"
              ? "Lark"
              : platform === "feishu"
                ? "Feishu"
                : ""
        }
        width={24}
        height={24}
      />
    </span>
  );
}

type Status = ImStatus & { spaces?: unknown[]; connections?: unknown[] };
export function GroupCollaborationPanel({
  status,
  diagnostics,
  projects,
  locale,
  refresh,
  onClose,
  returnFocusRef,
}: {
  status: Status;
  diagnostics: unknown;
  projects: Project[];
  locale: AppLocale;
  refresh(): Promise<void>;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const t = uiTranslator(locale);
  const [view, setView] = useState<"group" | "project">("group");
  const [selected, setSelected] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<AuthorizationDraft>();
  const [presenceNow, setPresenceNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setPresenceNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const [refreshingMembers, setRefreshingMembers] = useState(false);
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
  const visibleGroups = groups.filter(
    (group) =>
      group.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (view === "group" ||
        !projectFilter ||
        group.saved?.nativeGroup?.projectId === projectFilter),
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
  const validCommand =
    !!command &&
    imAuthorizationCommandSchema.safeParse(command).success &&
    (draft?.intent === "pause" || (draft?.grant.expiresAt ?? 0) > Date.now());
  const currentDraftTarget =
    draft?.target && groups.find((g) => key(g) === key(draft.target!));
  const identityTarget = currentDraftTarget ?? draft?.target;
  const identityRoster = imGroupRosterSchema.safeParse(
    (identityTarget?.saved as { roster?: unknown } | undefined)?.roster,
  );
  const ownerIdentity = command?.owner;
  const ownerKey = ownerIdentity && imIdentityKey(ownerIdentity);
  const ownerPerson = identityRoster.success
    ? identityRoster.data.members.find(
        (member) => imIdentityKey(member.identity) === ownerKey,
      )
    : undefined;
  const ownerParticipant = identityTarget?.saved?.participants.find(
    (member) => imIdentityKey(member.identity) === ownerKey,
  );
  const identityConnection = (
    status.connections as ImConnectionStatus[] | undefined
  )?.find(
    (item) =>
      item.id === ownerIdentity?.connectionId &&
      item.channel === ownerIdentity.channel,
  );
  const identityBot = identityRoster.success
    ? identityRoster.data.members.find(
        (member) =>
          member.self &&
          member.kind === "bot" &&
          member.identity.connectionId === ownerIdentity?.connectionId &&
          member.identity.channel === ownerIdentity.channel &&
          member.identity.tenantId === ownerIdentity.tenantId &&
          member.identity.appId === ownerIdentity.appId,
      )
    : undefined;
  const displayIdentityName = (...names: (string | undefined)[]) =>
    names
      .find(
        (name) =>
          name?.trim() &&
          ![
            ...Object.values(ownerIdentity ?? {}),
            ...Object.values(identityBot?.identity ?? {}),
            status.settings.deviceId,
          ].includes(name.trim()),
      )
      ?.trim() ?? t("GroupAuthorization.nameUnavailable");
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
          !validCommand ||
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
      change({ editPolicy: true, grant: { ...active, ...patch } });
    return (
      <div className="im-field-stack im-group-policy-fields">
        <Select
          label={t("AutomationPage_text.mode")}
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
  function memberList(target: GroupChoice) {
    const roster = imGroupRosterSchema.safeParse(
      (target.saved as { roster?: unknown } | undefined)?.roster,
    );
    const members = roster.success ? roster.data.members : [];
    return (
      <details className="im-group-members" open>
        <summary>
          <UsersThree size={16} aria-hidden="true" />
          {t("GroupAuthorization.members")}
          {members.length > 0 && <span>{members.length}</span>}
          <CaretRight
            className="im-group-members-caret"
            size={14}
            aria-hidden="true"
          />
        </summary>
        {members.length > 0 ? (
          <ul>
            {members.map((member) => {
              const presence = imGroupMemberStatus(
                member,
                status,
                target.saved?.id,
                Math.max(presenceNow, Date.now()),
              );
              return (
                <li key={imIdentityKey(member.identity)}>
                  <span className="im-group-member-name">
                    <span
                      className="im-group-member-avatar"
                      data-state={presence}
                      role="img"
                      aria-label={t(
                        member.kind === "bot"
                          ? "ImGroupMembers.message14"
                          : member.kind === "human"
                            ? "ImGroupMembers.message13"
                            : "ImGroupMembers.message12",
                      )}
                    >
                      {member.kind === "bot" ? (
                        <ArtemisIcon name="bot" width={18} height={18} />
                      ) : (
                        <User size={18} weight="fill" aria-hidden="true" />
                      )}
                    </span>
                    <span>
                      {member.name?.trim() &&
                      !Object.values(member.identity).includes(
                        member.name.trim(),
                      )
                        ? member.name
                        : t("GroupAuthorization.nameUnavailable")}
                    </span>
                  </span>
                  <span
                    className="im-group-member-status"
                    data-state={presence}
                  >
                    <span className="im-group-member-dot" aria-hidden="true" />
                    {t(
                      presence === "online"
                        ? "ImGroupMembers.message9"
                        : presence === "busy"
                          ? "GroupAuthorization.memberBusy"
                          : presence === "offline"
                            ? "ImGroupMembers.message8"
                            : "ImGroupMembers.message6",
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{t("GroupAuthorization.membersUnavailable")}</p>
        )}
        {roster.success && !roster.data.complete && members.length > 0 && (
          <p>{t("GroupAuthorization.membersPartial")}</p>
        )}
        {target.saved &&
          status.localGateway &&
          target.saved.nativeGroup?.ownerDeviceId ===
            status.settings.deviceId && (
            <Button
              size="compact"
              variant="quiet"
              disabled={locked || refreshingMembers}
              icon={<ArrowClockwise aria-hidden="true" />}
              onClick={async () => {
                setRefreshingMembers(true);
                try {
                  await window.artemis.manageIm({
                    action: "refresh-group-members",
                    spaceId: target.saved!.id,
                  });
                  await refresh();
                } catch (error) {
                  setError(String(error));
                } finally {
                  setRefreshingMembers(false);
                }
              }}
            >
              {t("GroupAuthorization.refresh")}
            </Button>
          )}
      </details>
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
      !!saved?.id &&
      !task.parentThreadId &&
      task.currentGroupEntry !== false &&
      task.group?.spaceId === saved?.id,
  );
  return (
    <Dialog
      open
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`im-group-dialog${draft ? " im-group-dialog--wizard" : ""}`}
      label={t("GroupAuthorization.title")}
      returnFocusRef={returnFocusRef}
      onOpenChange={(open) => {
        if (!open) navigate(onClose);
      }}
    >
      <header className="im-group-header">
        <h2 ref={heading} tabIndex={-1}>
          <span className="im-group-heading-icon">
            <UsersThree size={22} weight="duotone" aria-hidden="true" />
          </span>
          {t("GroupAuthorization.title")}
        </h2>
        <IconButton
          label={t("App_copy.renameClose")}
          icon={<X size={18} aria-hidden="true" />}
          onClick={() => navigate(onClose)}
        />
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
                  className="im-field-stack im-group-directory"
                  aria-label={t("GroupAuthorization.directory")}
                >
                  <div className="im-group-view-switch">
                    <Button
                      icon={<UsersThree weight="duotone" aria-hidden="true" />}
                      selected={view === "group"}
                      onClick={() => setView("group")}
                    >
                      {t("GroupAuthorization.byGroup")}
                    </Button>
                    <Button
                      icon={
                        <FolderSimple weight="duotone" aria-hidden="true" />
                      }
                      selected={view === "project"}
                      onClick={() => setView("project")}
                    >
                      {t("GroupAuthorization.byProject")}
                    </Button>
                  </div>
                  <div className="im-group-search">
                    <div className="im-group-search-field">
                      <MagnifyingGlass size={16} aria-hidden="true" />
                      <TextField
                        label={t("GroupAuthorization.search")}
                        labelVisibility="hidden"
                        placeholder={t("GroupAuthorization.search")}
                        value={query}
                        onValueChange={setQuery}
                      />
                    </div>
                    <IconButton
                      className="im-group-refresh"
                      label={t("GroupAuthorization.refresh")}
                      icon={<ArrowClockwise size={18} aria-hidden="true" />}
                      onClick={() =>
                        void refresh().catch((e) => setError(String(e)))
                      }
                    />
                  </div>
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
                      icon={<Plus aria-hidden="true" />}
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
                  <div className="im-group-list-heading">
                    <span>{t("GroupAuthorization.directory")}</span>
                    <span className="im-group-count">
                      {visibleGroups.length}
                    </span>
                  </div>
                  <div
                    className="im-group-list"
                    role="region"
                    aria-label={t("GroupAuthorization.directory")}
                    tabIndex={0}
                  >
                    {visibleGroups.map((group) => (
                      <Button
                        className="im-group-list-item"
                        key={key(group)}
                        selected={selected === key(group)}
                        onClick={() => setSelected(key(group))}
                      >
                        <GroupLogo group={group} />
                        <span className="im-group-row-copy">
                          <strong>{group.displayName}</strong>
                        </span>
                        <CaretRight
                          className="im-group-row-arrow"
                          size={14}
                          aria-hidden="true"
                        />
                      </Button>
                    ))}
                    {!visibleGroups.length && (
                      <div className="im-group-list-empty">
                        <UsersThree
                          size={28}
                          weight="duotone"
                          aria-hidden="true"
                        />
                        {!groups.length && (
                          <p>{t("GroupAuthorization.noGroups")}</p>
                        )}
                      </div>
                    )}
                  </div>
                  {query && (
                    <Button onClick={() => setQuery("")}>
                      {t("GroupAuthorization.clearSearch")}
                    </Button>
                  )}
                </nav>
                <section
                  className="im-field-stack im-group-detail"
                  aria-live="polite"
                >
                  {current ? (
                    <>
                      <header className="im-group-detail-header">
                        <GroupLogo group={current} />
                        <div className="im-group-title-copy">
                          <h3>{current.displayName}</h3>
                          <span className="im-group-status" data-state={state}>
                            {t(`GroupAuthorization.${state}`)}
                          </span>
                        </div>
                      </header>
                      {grant && (
                        <p className="im-group-project-name">
                          <FolderSimple
                            size={16}
                            weight="duotone"
                            aria-hidden="true"
                          />
                          {projects.find((p) => p.id === grant.projectId)?.name}
                        </p>
                      )}
                      {policySummary(grant)}
                      {scope && (
                        <dl className="im-group-summary">
                          <dt>{t("GroupAuthorization.readScope")}</dt>
                          <dd>
                            {scope.readPaths.length
                              ? scope.readPaths.join(" · ")
                              : t("ImDataPermissions.projectScope")}
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
                      <div className="im-group-actions im-group-primary-actions">
                        {!task && (
                          <p>{t("GroupAuthorization.firstMessage")}</p>
                        )}
                        <Button
                          variant="primary"
                          icon={
                            <ShieldCheck weight="duotone" aria-hidden="true" />
                          }
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
                                : "GroupAuthorization.edit",
                          )}
                        </Button>
                        {saved && (
                          <div className="im-group-secondary-actions">
                            {" "}
                            <Button
                              icon={<ArrowsLeftRight aria-hidden="true" />}
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
                            {saved.nativeGroup?.enabled && (
                              <Button
                                icon={<Pause aria-hidden="true" />}
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
                      </div>
                      {!current.owner && (
                        <InlineNotice tone="warning">
                          {t("GroupAuthorization.ownerRequired")}
                        </InlineNotice>
                      )}
                      {memberList(current)}
                    </>
                  ) : (
                    <div className="im-group-empty-detail">
                      <span className="im-group-empty-icon">
                        <ChatCircleDots
                          size={36}
                          weight="duotone"
                          aria-hidden="true"
                        />
                      </span>
                      <p>{t("GroupAuthorization.chooseGroup")}</p>
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <div className="im-group-wizard">
                <ol
                  className="im-group-steps"
                  aria-label={t("GroupAuthorization.steps")}
                >
                  {["project", "confirm"].map((step, index) => (
                    <li
                      key={step}
                      data-complete={draft.step > index + 1}
                      aria-current={
                        draft.step === index + 1 ? "step" : undefined
                      }
                    >
                      <span className="im-group-step-number" aria-hidden="true">
                        {draft.step > index + 1 ? (
                          <Check size={14} weight="bold" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span>
                        {t(
                          `GroupAuthorization.${step}` as "GroupAuthorization.project",
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="im-field-stack im-group-wizard-content">
                  {draft.target && (
                    <div className="im-group-draft-target">
                      <GroupLogo group={draft.target} />
                      <strong>{draft.target.displayName}</strong>
                    </div>
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
                              label: g.displayName,
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
                      {draft.intent === "rebind" &&
                        draft.projectId &&
                        draft.projectId !==
                          draft.target?.saved?.nativeGroup?.projectId && (
                          <InlineNotice tone="warning">
                            {t("GroupAuthorization.rebindImpact", {
                              before:
                                projects.find(
                                  (p) =>
                                    p.id ===
                                    draft.target?.saved?.nativeGroup?.projectId,
                                )?.name ?? t("GroupAuthorization.project"),
                              after:
                                projects.find((p) => p.id === draft.projectId)
                                  ?.name ??
                                t("GroupAuthorization.chooseProject"),
                            })}
                          </InlineNotice>
                        )}
                    </>
                  )}
                  {draft.step === 2 && active && command && (
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
                          {draft.target?.displayName ??
                            t("ImNativeGroups.message1")}
                        </dd>
                        <dt>{t("GroupAuthorization.project")}</dt>
                        <dd>
                          {
                            projects.find((p) => p.id === command.projectId)
                              ?.name
                          }
                        </dd>
                        <dt>{t("GroupAuthorization.sharedPolicy")}</dt>
                        <dd className="im-group-editable-policy">
                          {draft.intent === "pause"
                            ? policySummary(active)
                            : policyFields()}
                        </dd>
                        {draft.intent === "pause" && (
                          <>
                            <dt>{t("GroupAuthorization.readScope")}</dt>
                            <dd>
                              {command.scope.readMode === "selected" ||
                              command.scope.readPaths.length
                                ? command.scope.readPaths.join(" · ")
                                : t("ImDataPermissions.projectScope")}
                            </dd>
                            <dt>{t("GroupAuthorization.writeScope")}</dt>
                            <dd>
                              {active.mode !== "execute"
                                ? t("GroupAuthorization.denied")
                                : command.scope.writeMode === "project"
                                  ? t("ImDataPermissions.projectScope")
                                  : command.scope.writePaths.join(" · ") ||
                                    t("GroupAuthorization.denied")}
                            </dd>
                          </>
                        )}
                      </dl>
                      {draft.intent !== "pause" && (
                        <ImDataPermissions
                          key={draft.projectId}
                          grant={active}
                          t={t}
                          disabled={locked}
                          audiences={[]}
                          draftMode
                          compact
                          showAudienceSelector={false}
                          onChange={(security) =>
                            change({ grant: { ...active, security } })
                          }
                        />
                      )}
                      <h4 className="im-group-section-label">
                        {t("GroupAuthorization.authorizationIdentity")}
                      </h4>
                      <div className="im-group-identity-summary">
                        {identityTarget && <GroupLogo group={identityTarget} />}
                        <dl>
                          <dt>{t("GroupAuthorization.botName")}</dt>
                          <dd>
                            {displayIdentityName(
                              identityBot?.name,
                              identityConnection?.name,
                            )}
                          </dd>
                          <dt>{t("GroupAuthorization.accountName")}</dt>
                          <dd>
                            {displayIdentityName(
                              ownerPerson?.name,
                              ownerParticipant?.name,
                            )}
                          </dd>
                        </dl>
                      </div>
                      <p>{t("GroupAuthorization.futureFiles")}</p>
                      {identityTarget && memberList(identityTarget)}
                      {policyChanged && affected.length > 0 && (
                        <InlineNotice tone="warning">
                          <p>{t("GroupAuthorization.policyImpact")}</p>
                          {affected.map((g) => (
                            <p key={key(g)}>{g.displayName}</p>
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
                              .map((g) => g.displayName)
                              .join(" · ")}
                          </InlineNotice>
                        )}
                      {draft.intent === "rebind" &&
                        draft.projectId &&
                        draft.projectId !==
                          draft.target?.saved?.nativeGroup?.projectId && (
                          <InlineNotice tone="warning">
                            {t("GroupAuthorization.rebindImpact", {
                              before:
                                projects.find(
                                  (p) =>
                                    p.id ===
                                    draft.target?.saved?.nativeGroup?.projectId,
                                )?.name ?? t("GroupAuthorization.project"),
                              after:
                                projects.find((p) => p.id === draft.projectId)
                                  ?.name ??
                                t("GroupAuthorization.chooseProject"),
                            })}
                          </InlineNotice>
                        )}
                      <Checkbox
                        label={t("GroupAuthorization.confirmSharing")}
                        checked={
                          draft.confirmation === command.confirmationFingerprint
                        }
                        disabled={locked || conflict || !validCommand}
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
                </div>
                <footer className="im-group-actions im-group-wizard-footer">
                  <Button
                    variant="quiet"
                    onClick={() => navigate(() => setDraft(undefined))}
                  >
                    {t("App_copy.renameCancel")}
                  </Button>
                  {draft.step > 1 && (
                    <Button
                      icon={<ArrowLeft aria-hidden="true" />}
                      disabled={locked}
                      onClick={() => change({ step: 1 })}
                    >
                      {t("GroupAuthorization.back")}
                    </Button>
                  )}
                  {draft.step === 1 ? (
                    <Button
                      variant="primary"
                      icon={<ArrowRight aria-hidden="true" />}
                      disabled={
                        locked ||
                        !command ||
                        conflict ||
                        !validCommand ||
                        (draft.intent !== "pause" &&
                          draft.grant.expiresAt <= Date.now())
                      }
                      onClick={() => change({ step: 2 })}
                    >
                      {t("GroupAuthorization.next")}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      icon={<ShieldCheck aria-hidden="true" />}
                      disabled={
                        locked ||
                        conflict ||
                        !command ||
                        !validCommand ||
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

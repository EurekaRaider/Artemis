import { type Status, type GroupChoice } from "./groups/group-values.js";
import { useGroupAuthorizationState } from "./groups/use-group-authorization-state.js";
import { useGroupDirectory } from "./groups/use-group-directory.js";
import { createGroupAuthorizationSummary } from "./groups/create-group-authorization-summary.js";
import { useGroupAuthorizationFocus } from "./groups/use-group-authorization-focus.js";
import { createGroupAuthorizationActions } from "./groups/create-group-authorization-actions.js";
import { createGroupPolicyRenderers } from "./groups/create-group-policy-renderers.js";
import { createGroupMemberRenderer } from "./groups/create-group-member-renderer.js";
import { createGroupAuthorizationRenderer } from "./groups/create-group-authorization-renderer.js";
import { isExecutionMode } from "@artemis/protocol";

import {
  imConversationKey,
  imGroupRosterSchema,
  type AppLocale,
  type ExecutionGrant,
  type ImAuthorizationOperation,
  type ImConnectionStatus,
  type Project,
} from "@artemis/protocol";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  Check,
  CaretRight,
  ChatCircleDots,
  FolderSimple,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  Warning,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import groupChannelIcon from "../assets/im-group-icon.svg";
import feishuChannelIcon from "../assets/feishu-channel.png";
import slackChannelIcon from "../assets/slack-channel.svg";

import { Button, IconButton } from "@artemis/ui/actions";
import { Select, TextField } from "@artemis/ui/forms";
import { Dialog, InlineNotice } from "@artemis/ui/feedback";

import { ImDataPermissions } from "./ImDataPermissions";

import { imChannelLabel } from "./ImNavigation";
import {
  createAuthorizationDraft,
  type AuthorizationDraft,
  type AuthorizationTarget,
} from "./im-authorization-draft";
import "./group-collaboration.css";

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
  const useGroupAuthorizationStateRuntime = useGroupAuthorizationState({
    locale,
  });
  const {
    t,
    view,
    setView,
    selected,
    setSelected,
    projectFilter,
    setProjectFilter,
    query,
    setQuery,
    draft,
    setDraft,
    presenceNow,
    refreshingMembers,
    setRefreshingMembers,
    discard,
    setDiscard,
    operation,
    setOperation,
    error,
    setError,
    submitting,
    setSubmitting,
    sending,
    heading,
    body,
  } = useGroupAuthorizationStateRuntime;

  const useGroupDirectoryRuntime = useGroupDirectory({
    diagnostics,
    status,
    t,
    view,
    projectFilter,
    query,
    selected,
    get rosterFor() {
      return rosterFor;
    },
    draft,
    operation,
    submitting,
  });
  const {
    groups,
    directory,
    visibleGroups,
    key,
    current,
    currentGroup,
    currentPlatform,
    memberTarget,
    command,
    validCommand,
    currentDraftTarget,
    identityTarget,
    ownerPerson,
    ownerParticipant,
    identityConnection,
    identityBot,
    displayIdentityName,
    conflict,
    pending,
    locked,
    active,
    localScope,
    fullLocal,
  } = useGroupDirectoryRuntime;

  const createGroupAuthorizationSummaryRuntime =
    createGroupAuthorizationSummary({
      draft,
      command,
      fullLocal,
      t,
      locked,
      conflict,
      validCommand,
      setDraft,
      groups,
      locale,
    });
  const { confirmationControl, policyChanged, affected, expiration } =
    createGroupAuthorizationSummaryRuntime;

  const useGroupAuthorizationFocusRuntime = useGroupAuthorizationFocus({
    heading,
    body,
    draft,
    discard,
    pending,
    setDraft,
    conflict,
  });

  const createGroupAuthorizationActionsRuntime =
    createGroupAuthorizationActions({
      setDiscard,
      draft,
      pending,
      submitting,
      setDraft,
      setError,
      setOperation,
      status,
      view,
      sending,
      command,
      validCommand,
      conflict,
      setSubmitting,
      refresh,
      setSelected,
      setRefreshingMembers,
    });
  function navigate(
    action: () => void,
  ): ReturnType<typeof createGroupAuthorizationActionsRuntime.navigate> {
    return createGroupAuthorizationActionsRuntime.navigate(action);
  }
  function change(
    patch: Partial<AuthorizationDraft>,
  ): ReturnType<typeof createGroupAuthorizationActionsRuntime.change> {
    return createGroupAuthorizationActionsRuntime.change(patch);
  }
  function begin(
    target: AuthorizationTarget | undefined,
    projectId: string,
    intent: AuthorizationDraft["intent"],
    entry: AuthorizationDraft["entry"] = view,
  ): ReturnType<typeof createGroupAuthorizationActionsRuntime.begin> {
    return createGroupAuthorizationActionsRuntime.begin(
      target,
      projectId,
      intent,
      entry,
    );
  }
  function submit(
    retry?: ImAuthorizationOperation,
  ): ReturnType<typeof createGroupAuthorizationActionsRuntime.submit> {
    return createGroupAuthorizationActionsRuntime.submit(retry);
  }

  const createGroupPolicyRenderersRuntime = createGroupPolicyRenderers({
    draft,
    active,
    change,
    t,
    locked,
    fullLocal,
    expiration,
  });
  function policyFields(): ReturnType<
    typeof createGroupPolicyRenderersRuntime.policyFields
  > {
    return createGroupPolicyRenderersRuntime.policyFields();
  }
  function policySummary(
    value: ExecutionGrant | undefined,
    compact = false,
  ): ReturnType<typeof createGroupPolicyRenderersRuntime.policySummary> {
    return createGroupPolicyRenderersRuntime.policySummary(value, compact);
  }

  function rosterFor(target: GroupChoice) {
    const roster = imGroupRosterSchema.safeParse(
      (target.saved as { roster?: unknown } | undefined)?.roster,
    );
    return roster.success ? roster.data : undefined;
  }
  function botName(target: GroupChoice) {
    const identity = target.owner ?? target.identities[0];
    const bot = rosterFor(target)?.members.find(
      (member) =>
        member.self &&
        member.kind === "bot" &&
        member.identity.connectionId === target.conversation.connectionId &&
        (!identity ||
          (member.identity.channel === identity.channel &&
            member.identity.tenantId === identity.tenantId &&
            member.identity.appId === identity.appId)),
    );
    const connection = (
      status.connections as ImConnectionStatus[] | undefined
    )?.find((item) => item.id === target.conversation.connectionId);
    return (
      [bot?.name, connection?.name]
        .find(
          (name) =>
            name?.trim() &&
            !Object.values(bot?.identity ?? identity ?? {}).includes(
              name.trim(),
            ) &&
            name.trim() !== target.conversation.connectionId,
        )
        ?.trim() ?? t("GroupAuthorization.nameUnavailable")
    );
  }
  const createGroupMemberRendererRuntime = createGroupMemberRenderer({
    rosterFor,
    status,
    t,
    presenceNow,
    locale,
    locked,
    refreshingMembers,
    setRefreshingMembers,
    refresh,
    setError,
    current,
  });
  function memberList(
    target: GroupChoice,
    targets: GroupChoice[],
  ): ReturnType<typeof createGroupMemberRendererRuntime.memberList> {
    return createGroupMemberRendererRuntime.memberList(target, targets);
  }

  const createGroupAuthorizationRendererRuntime =
    createGroupAuthorizationRenderer({
      status,
      botName,
      locked,
      t,
      projects,
      policySummary,
      begin,
      key,
    });
  function authorizationRow(
    target: GroupChoice,
  ): ReturnType<
    typeof createGroupAuthorizationRendererRuntime.authorizationRow
  > {
    return createGroupAuthorizationRendererRuntime.authorizationRow(target);
  }

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
                    {visibleGroups.map((entry) => {
                      const group = entry.targets[0]!;
                      return (
                        <Button
                          className="im-group-list-item"
                          key={entry.key}
                          selected={current?.key === entry.key}
                          onClick={() => setSelected(entry.key)}
                        >
                          <GroupLogo group={group} />
                          <span className="im-group-row-copy">
                            <strong>{group.displayName}</strong>
                            <small>
                              {t("GroupAuthorization.localBots", {
                                count: entry.targets.length,
                              })}
                            </small>
                          </span>
                          <CaretRight
                            className="im-group-row-arrow"
                            size={14}
                            aria-hidden="true"
                          />
                        </Button>
                      );
                    })}
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
                <section className="im-group-detail" aria-live="polite">
                  {current && currentGroup ? (
                    <>
                      <header className="im-group-detail-header">
                        <GroupLogo group={currentGroup} />
                        <div className="im-group-title-copy">
                          <h3>{currentGroup.displayName}</h3>
                          <p>
                            {currentPlatform === "lark"
                              ? "Lark"
                              : currentPlatform
                                ? imChannelLabel(currentPlatform, t)
                                : t("ImNativeGroups.message1")}
                            {memberTarget?.roster && (
                              <>
                                {" "}
                                · {t("GroupAuthorization.members")}{" "}
                                {memberTarget.roster.members.length}
                              </>
                            )}
                          </p>
                        </div>
                        <span className="im-group-bot-count">
                          {t("GroupAuthorization.localBots", {
                            count: current.targets.length,
                          })}
                        </span>
                      </header>
                      <div className="im-group-authorizations-heading">
                        <h4>{t("GroupAuthorization.botAuthorizations")}</h4>
                        <p>{t("GroupAuthorization.botAuthorizationsHint")}</p>
                      </div>
                      <div className="im-group-authorizations">
                        {current.targets.map(authorizationRow)}
                      </div>
                      {memberTarget &&
                        memberList(memberTarget.target, current.targets)}
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
                      <span className="im-group-draft-bot">
                        {botName(draft.target)}
                      </span>
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
                              label: `${g.displayName} · ${botName(g)}`,
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
                            ? policySummary(
                                fullLocal
                                  ? { ...active, approval: "automatic" }
                                  : active,
                              )
                            : policyFields()}
                        </dd>
                        {draft.intent === "pause" && (
                          <>
                            <dt>{t("GroupAuthorization.readScope")}</dt>
                            <dd>
                              {fullLocal
                                ? t("GroupAuthorization.fullLocal")
                                : command.scope.readMode === "selected" ||
                                    command.scope.readPaths.length
                                  ? command.scope.readPaths.join(" · ")
                                  : t("ImDataPermissions.projectScope")}
                            </dd>
                            <dt>{t("GroupAuthorization.writeScope")}</dt>
                            <dd>
                              {!isExecutionMode(active.mode)
                                ? t("GroupAuthorization.denied")
                                : fullLocal
                                  ? t("GroupAuthorization.fullLocal")
                                  : command.scope.writeMode === "project"
                                    ? t("ImDataPermissions.projectScope")
                                    : command.scope.writePaths.join(" · ") ||
                                      t("GroupAuthorization.denied")}
                            </dd>
                          </>
                        )}
                      </dl>
                      {draft.intent !== "pause" && localScope && (
                        <fieldset className="im-local-access" disabled={locked}>
                          <legend>{t("GroupAuthorization.localAccess")}</legend>
                          <p className="im-local-access-hint">
                            {t("GroupAuthorization.localAccessHint", {
                              bot: botName(draft.target!),
                            })}
                          </p>
                          {(["project", "full"] as const).map((access) => (
                            <label
                              className="im-local-access-option"
                              data-selected={
                                (localScope.localAccess ?? "project") === access
                              }
                              data-access={access}
                              key={access}
                            >
                              <input
                                type="radio"
                                name="im-local-access"
                                value={access}
                                checked={
                                  (localScope.localAccess ?? "project") ===
                                  access
                                }
                                onChange={() =>
                                  change({
                                    grant: {
                                      ...active,
                                      security: {
                                        ...active.security!,
                                        scopes: [
                                          {
                                            ...localScope,
                                            localAccess: access,
                                          },
                                        ],
                                      },
                                    },
                                  })
                                }
                              />
                              <span>
                                <strong>
                                  {t(
                                    access === "full"
                                      ? "GroupAuthorization.fullLocal"
                                      : "GroupAuthorization.projectLocal",
                                  )}
                                </strong>
                                <span>
                                  {t(
                                    access === "full"
                                      ? "GroupAuthorization.fullLocalHint"
                                      : "GroupAuthorization.projectLocalHint",
                                  )}
                                </span>
                              </span>
                            </label>
                          ))}
                          {fullLocal && (
                            <>
                              <div
                                className="im-local-access-warning"
                                role="alert"
                              >
                                <Warning
                                  size={24}
                                  weight="fill"
                                  aria-hidden="true"
                                />
                                <div>
                                  <strong>
                                    {t("GroupAuthorization.fullLocalRisk")}
                                  </strong>
                                  <ul>
                                    <li>
                                      {t("GroupAuthorization.fullLocalFiles")}
                                    </li>
                                    <li>
                                      {t(
                                        "GroupAuthorization.fullLocalMessages",
                                      )}
                                    </li>
                                    <li>
                                      {t("GroupAuthorization.fullLocalSharing")}
                                    </li>
                                    <li>
                                      {t("GroupAuthorization.fullLocalTrust")}
                                    </li>
                                  </ul>
                                </div>
                              </div>
                              <p className="im-local-access-hint">
                                {t("GroupAuthorization.fullLocalScope")}
                              </p>
                              {confirmationControl}
                            </>
                          )}
                        </fieldset>
                      )}
                      {draft.intent !== "pause" && !fullLocal && (
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
                      {!fullLocal && (
                        <p>{t("GroupAuthorization.futureFiles")}</p>
                      )}
                      {policyChanged && affected.length > 0 && (
                        <InlineNotice tone="warning">
                          <p>{t("GroupAuthorization.policyImpact")}</p>
                          {affected.map((g) => (
                            <p key={key(g)}>
                              {g.displayName} · {botName(g)}
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
                              .map((g) => `${g.displayName} · ${botName(g)}`)
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
                      {(!fullLocal || draft.intent === "pause") &&
                        confirmationControl}
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
                      {t(
                        fullLocal && draft.intent !== "pause"
                          ? "GroupAuthorization.submitFullLocal"
                          : "GroupAuthorization.submit",
                      )}
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

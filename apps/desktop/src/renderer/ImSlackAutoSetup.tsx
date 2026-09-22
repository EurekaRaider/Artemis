import { useEffect, useRef, useState } from "react";
import {
  imSlackSetupStatusSchema,
  type ImManagement,
  type ImSlackSetupStatus,
} from "@artemis/protocol";
import {
  ArrowClockwise,
  ArrowRight,
  ArrowSquareOut,
  ChatCircleText,
  Check,
  Clock,
  Copy,
  PlugsConnected,
  Robot,
  ShieldCheck,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Button } from "@artemis/ui/actions";
import { InlineNotice } from "@artemis/ui/feedback";
import { TextField } from "@artemis/ui/forms";
import { slackBotNameKey } from "../shared/slack-manifest.js";
import type { UiTranslate, UiMessageKey } from "../shared/ui-text.js";
import "./im-slack-setup.css";

const states: Record<ImSlackSetupStatus["state"], UiMessageKey> = {
  idle: "ImSlackAutoSetup.description",
  authorizing: "ImSlackAutoSetup.authorizing",
  "awaiting-code": "ImSlackAutoSetup.instructions",
  configuring: "ImSlackAutoSetup.configuring",
  "approval-required": "ImSlackAutoSetup.approval",
  interrupted: "ImSlackAutoSetup.interrupted",
  "recovery-required": "ImSlackAutoSetup.recovery",
  connected: "ImSlackAutoSetup.connected",
  cancelled: "ImSlackAutoSetup.description",
  expired: "ImSlackAutoSetup.expired",
  error: "ImSlackAutoSetup.failed",
};
const steps = [
  { label: "ImSlackAutoSetup.stepName", Icon: Robot },
  { label: "ImSlackAutoSetup.stepAuthorize", Icon: ChatCircleText },
  { label: "ImSlackAutoSetup.stepConnect", Icon: PlugsConnected },
] as const;

export function ImSlackAutoSetup({
  t,
  busy,
  disabled,
  connections = [],
  onConnected,
}: {
  t: UiTranslate;
  busy: boolean;
  disabled: boolean;
  connections?: readonly { id: string; name: string }[];
  onConnected(id: string): void;
}) {
  const [status, setStatus] = useState<ImSlackSetupStatus>({ state: "idle" });
  const [name, setName] = useState("Artemis_bot");
  const [challenge, setChallenge] = useState("");
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const nameEdited = useRef(false),
    nameRestored = useRef(false),
    epoch = useRef(0),
    mounted = useRef(false),
    watching = useRef(false);
  const callback = useRef(onConnected);
  callback.current = onConnected;
  const completed = useRef(new Set<string>());
  function accept(value: unknown) {
    const next = imSlackSetupStatusSchema.parse(value);
    if (next.state === "cancelled") next.state = "idle";
    setStatus(next);
    setFailed(false);
    if (next.name && !nameEdited.current) {
      nameRestored.current = true;
      setName(next.name);
    }
    if (next.state === "idle") {
      setChallenge("");
      setCopied(false);
    }
    if (
      next.state === "connected" &&
      next.connectionId &&
      watching.current &&
      !completed.current.has(next.connectionId)
    ) {
      completed.current.add(next.connectionId);
      setChallenge("");
      callback.current(next.connectionId);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const current = ++epoch.current;
    void window.artemis
      .getSnapshot()
      .then((snapshot) => {
        if (mounted.current && !nameEdited.current && !nameRestored.current)
          setName(`${snapshot.userName.trim().slice(0, 31) || "Artemis"}_bot`);
      })
      .catch(() => undefined);
    if (!disabled)
      void window.artemis
        .manageIm({ action: "slack-setup-status" })
        .then((value) => {
          if (current !== epoch.current) return;
          const next = imSlackSetupStatusSchema.parse(value);
          if (next.state !== "connected") {
            watching.current = true;
            accept(next);
          }
        })
        .catch(() => {
          if (current === epoch.current) setFailed(true);
        });
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, [disabled]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (
      !status.sessionId ||
      !["authorizing", "awaiting-code", "configuring"].includes(status.state)
    )
      return;
    let pending = false;
    const current = epoch.current;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void window.artemis
        .manageIm({
          action: "slack-setup-status",
          sessionId: status.sessionId!,
        })
        .then((value) => {
          if (current === epoch.current) accept(value);
        })
        .catch(() => {
          if (current === epoch.current) setFailed(true);
        })
        .finally(() => {
          pending = false;
        });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status.sessionId, status.state]);
  async function request(action: ImManagement) {
    const current = ++epoch.current;
    setWorking(true);
    setFailed(false);
    watching.current = true;
    try {
      const value = await window.artemis.manageIm(action);
      if (current === epoch.current) accept(value);
    } catch {
      if (current === epoch.current) setFailed(true);
    } finally {
      if (mounted.current && current === epoch.current) setWorking(false);
    }
  }
  const botName = name.trim();
  const nameTaken =
    connections.some(
      (connection) =>
        connection.id !== status.connectionId &&
        slackBotNameKey(connection.name) === slackBotNameKey(botName),
    ) ||
    (status.error === "name-taken" &&
      slackBotNameKey(status.name ?? "") === slackBotNameKey(botName));
  const validName = botName.length > 0 && botName.length <= 35 && !nameTaken;
  const active = ["authorizing", "configuring"].includes(status.state);
  const blocked = busy || working || disabled;
  const canStart =
    !active &&
    status.state !== "awaiting-code" &&
    status.state !== "recovery-required";
  const initial = status.state === "idle" || status.state === "connected";
  const step =
    status.state === "idle" || status.error === "name-taken"
      ? 0
      : ["authorizing", "awaiting-code", "expired"].includes(status.state)
        ? 1
        : 2;
  const StatusIcon =
    status.state === "connected"
      ? Check
      : status.state === "interrupted"
        ? ArrowClockwise
        : ["recovery-required", "expired"].includes(status.state)
          ? WarningCircle
          : Clock;
  const showError = failed || (status.error && status.error !== "name-taken");
  return (
    <div className="im-slack-setup">
      <ol className="im-slack-steps" aria-label={t("ImSlackAutoSetup.steps")}>
        {steps.map(({ label, Icon }, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            data-complete={index < step || status.state === "connected"}
          >
            <span className="im-slack-step-icon">
              {index < step || status.state === "connected" ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Icon size={16} aria-hidden="true" />
              )}
            </span>
            <span>{t(label)}</span>
          </li>
        ))}
      </ol>
      <TextField
        label={t("ImSlackAutoSetup.name")}
        description={canStart ? t("ImSlackAutoSetup.nameHint") : undefined}
        error={nameTaken ? t("ImSlackAutoSetup.nameTaken") : undefined}
        value={name}
        maxLength={35}
        autoComplete="off"
        spellCheck={false}
        disabled={blocked}
        readOnly={!canStart}
        onValueChange={(value) => {
          nameEdited.current = true;
          setName(value);
        }}
      />
      {status.state === "idle" || status.error === "name-taken" ? (
        <p className="im-slack-description" role="status">
          {t("ImSlackAutoSetup.description")}
        </p>
      ) : status.state === "awaiting-code" ? (
        <p className="im-slack-description" role="status">
          {t("ImSlackAutoSetup.instructions")}
        </p>
      ) : (
        status.state !== "error" && (
          <div className="im-slack-status" role="status" aria-busy={active}>
            <StatusIcon size={18} aria-hidden="true" />
            <p>{t(states[status.state])}</p>
          </div>
        )
      )}
      {disabled && (
        <InlineNotice tone="info">
          {t("ImSlackAutoSetup.localRequired")}
        </InlineNotice>
      )}
      {status.authorizationCommand && status.state === "awaiting-code" && (
        <>
          <div className="im-slack-command">
            <div className="im-slack-command-head">
              <span>
                <ChatCircleText size={15} aria-hidden="true" />
                {t("ImSlackAutoSetup.command")}
              </span>
              <Button
                variant="quiet"
                size="compact"
                icon={copied ? <Check /> : <Copy />}
                disabled={blocked}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(status.authorizationCommand!)
                    .then(() => setCopied(true))
                    .catch(() => setFailed(true))
                }
              >
                {t(
                  copied ? "ImSlackAutoSetup.copied" : "ImSlackAutoSetup.copy",
                )}
              </Button>
            </div>
            <TextField
              label={t("ImSlackAutoSetup.command")}
              labelVisibility="hidden"
              value={status.authorizationCommand}
              onValueChange={() => undefined}
              readOnly
              spellCheck={false}
            />
          </div>
          <TextField
            label={t("ImSlackAutoSetup.code")}
            description={t("ImSlackAutoSetup.confirmHint")}
            value={challenge}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={32}
            onValueChange={setChallenge}
            disabled={blocked}
          />
        </>
      )}
      {showError && (
        <InlineNotice tone="danger" role="alert">
          {t(
            status.error === "invalid-code"
              ? "ImSlackAutoSetup.invalidCode"
              : status.error === "identity"
                ? "ImSlackAutoSetup.identity"
                : "ImSlackAutoSetup.failed",
          )}
        </InlineNotice>
      )}
      <div className="im-slack-actions">
        <span className="im-slack-privacy">
          <ShieldCheck size={14} aria-hidden="true" />
          {t("ImSlackAutoSetup.privacy")}
        </span>
        <div className="im-slack-action-buttons">
          {status.sessionId &&
            !["idle", "connected"].includes(status.state) && (
              <Button
                variant="quiet"
                icon={<X />}
                disabled={busy || working}
                onClick={() => {
                  setChallenge("");
                  void request({
                    action: "slack-setup-cancel",
                    sessionId: status.sessionId!,
                  });
                }}
              >
                {t("ImSlackAutoSetup.cancel")}
              </Button>
            )}
          {status.state === "awaiting-code" && (
            <Button
              variant="primary"
              icon={<PlugsConnected />}
              loading={working}
              disabled={
                blocked || !/^[a-zA-Z0-9]{6,32}$/u.test(challenge.trim())
              }
              onClick={() => {
                const code = challenge.trim();
                setChallenge("");
                void request({
                  action: "slack-setup-submit",
                  sessionId: status.sessionId!,
                  challenge: code,
                });
              }}
            >
              {t("ImSlackAutoSetup.submit")}
            </Button>
          )}
          {canStart && (
            <Button
              variant="primary"
              icon={initial ? <ArrowRight /> : <ArrowClockwise />}
              loading={working}
              disabled={blocked || !validName}
              onClick={() =>
                void request({
                  action: "slack-setup-start",
                  name: botName,
                  ...(status.sessionId && status.state !== "connected"
                    ? { sessionId: status.sessionId }
                    : {}),
                })
              }
            >
              {t(initial ? "ImSlackAutoSetup.start" : "ImSlackAutoSetup.retry")}
            </Button>
          )}
        </div>
      </div>
      {(status.appId || status.state === "recovery-required") && (
        <div className="im-slack-links">
          <a
            href={`https://api.slack.com/apps/${encodeURIComponent(status.appId ?? "")}`}
            target="_blank"
            rel="noreferrer"
          >
            <ArrowSquareOut size={14} aria-hidden="true" />
            {t(
              status.appId
                ? "ImSlackAutoSetup.existingApp"
                : "ImSlackAutoSetup.manageApps",
            )}
          </a>
        </div>
      )}
    </div>
  );
}

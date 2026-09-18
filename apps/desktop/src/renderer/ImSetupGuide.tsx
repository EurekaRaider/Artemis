import { type UiTranslate } from "../shared/ui-text.js";
import type { AppLocale, ImStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { ManagementSection } from "@artemis/ui/management";

type Translate = UiTranslate;

export function ImGatewayInstructions({
  t,
  busy,
  ready,
  setup,
  useRemote,
  exportPackage,
}: {
  t: Translate;
  busy: boolean;
  ready: boolean;
  setup(): void;
  useRemote(): void;
  exportPackage(): void;
}) {
  return (
    <ManagementSection
      className="im-flow-section"
      title={t("ImSetupGuide.message9")}
    >
      {/* 就绪后不再展示禁用态按钮，只留提示。 */}
      {!ready && (
        <Button disabled={busy} onClick={setup}>
          {t("ImSetupGuide.message1")}
        </Button>
      )}
      <div className="im-gateway-tip">
        <p className="im-gateway-tip-head">{t("ImSetupGuide.message25")}</p>
        <p>{t("ImSetupGuide.message3")}</p>
        <p>{t("ImSetupGuide.message26")}</p>
      </div>
      <details className="im-gateway-fold">
        <summary>{t("ImSetupGuide.message4")}</summary>
        <div className="im-gateway-fold-body">
          <p>{t("ImSetupGuide.message5")}</p>
          <div className="im-actions">
            <Button disabled={busy} onClick={useRemote}>
              {t("ImSetupGuide.message6")}
            </Button>
            <Button disabled={busy} onClick={exportPackage}>
              {t("ImSetupGuide.message7")}
            </Button>
          </div>
          <p>{t("ImSetupGuide.message8")}</p>
          <pre className="im-command">node gateway.mjs</pre>
        </div>
      </details>
    </ManagementSection>
  );
}

export function ImFirstTaskInstructions({
  t,
  copy,
  slack = false,
}: {
  slack?: boolean;
  t: Translate;
  copy(text: string): void;
}) {
  const prefix = slack ? "" : "/";
  const commands = [
    {
      command: `${prefix}projects`,
      detail: t("ImSetupGuide.message11"),
    },
    {
      // Clipboard commands must not contain display-only bidi isolates.
      command: t("ImSetupGuide.message12").replace("{{value1}}", () => prefix),
      detail: t("ImSetupGuide.message13"),
    },
    {
      command: `${prefix}status`,
      detail: t("ImSetupGuide.message14"),
    },
  ];
  return (
    <ManagementSection
      className="im-flow-section"
      title={t("ImSetupGuide.message23")}
      description={t("ImSetupGuide.message24")}
    >
      <ol className="im-test-steps">
        {commands.map((item) => (
          <li key={item.command}>
            <div className="im-actions">
              <code className="im-identifier">{item.command}</code>
              <Button onClick={() => copy(item.command)}>
                {t("ImSetupGuide.message15")}
              </Button>
            </div>
            <p>{item.detail}</p>
          </li>
        ))}
      </ol>
      <p>{t("ImSetupGuide.message16")}</p>
      <details>
        <summary>{t("ImSetupGuide.message17")}</summary>
        <ul>
          <li>{t("ImSetupGuide.message18")}</li>
          <li>{t("ImSetupGuide.message19")}</li>
          <li>{t("ImSetupGuide.message20")}</li>
          <li>{t("ImSetupGuide.message21")}</li>
          <li>{t("ImSetupGuide.message22")}</li>
        </ul>
      </details>
    </ManagementSection>
  );
}

import { type UiTranslate } from "../shared/ui-text.js";
import type { AppLocale, ImStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { ManagementSection } from "@artemis/ui/management";

type Translate = UiTranslate;

export function ImGatewayInstructions({
  t,
  onOpen,
}: {
  t: Translate;
  onOpen(): void;
}) {
  // 入口卡：点击进入整幅二级卡（不再内联折叠展开）。
  return (
    <button type="button" className="im-gateway-fold" onClick={onOpen}>
      <span className="im-gateway-fold-head">{t("ImSetupGuide.message4")}</span>
    </button>
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

import { type UiTranslate } from "../shared/ui-text.js";
import { Button } from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";

export { slackAppManifest } from "../shared/slack-manifest.js";

export function ImSlackSetup({
  t,
  copy,
  busy,
}: {
  t: UiTranslate;
  copy(): void;
  busy: boolean;
}) {
  const [beforePairingIcon, afterPairingIcon] = t(
    "ImSlackSetup.message20",
  ).split("{{pairingIcon}}");

  return (
    <>
      <p>{t("ImSlackSetup.message1")}</p>
      <Button disabled={busy} onClick={copy}>
        {t("ImSlackSetup.message2")}
      </Button>
      <p>{t("ImSlackSetup.message3")}</p>
      <details>
        <summary>{t("ImSlackSetup.message4")}</summary>
        <ol>
          <li>
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noreferrer"
            >
              {t("ImSlackSetup.message5")}
            </a>
            {t("ImSlackSetup.message6")}
          </li>
          <li>{t("ImSlackSetup.message7")}</li>
          <li>
            {t("ImSlackSetup.message8")}
            <ul>
              <li>
                <code>member_joined_channel</code>
                {t("ImSlackSetup.message9")}
              </li>
              <li>
                <code>member_left_channel</code>
                {t("ImSlackSetup.message10")}
              </li>
              <li>
                <code>channel_deleted</code>
                {", "}
                <code>group_deleted</code>
              </li>
              <li>
                <code>channel_archive</code>
              </li>
              <li>
                <code>group_archive</code>
              </li>
            </ul>
            {t("ImSlackSetup.message11")}
          </li>
          <li>{t("ImSlackSetup.message12")}</li>
          <li>{t("ImSlackSetup.message13")}</li>
        </ol>
        <p>{t("ImSlackSetup.message14")}</p>
      </details>
      <details>
        <summary>{t("ImSlackSetup.message15")}</summary>
        <ol>
          <li>
            {t("ImSlackSetup.message16")}{" "}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noreferrer"
            >
              {t("ImSlackSetup.message5")}
            </a>
          </li>
          <li>{t("ImSlackSetup.message18")}</li>
          <li>{t("ImSlackSetup.message19")}</li>
          <li>
            {beforePairingIcon}
            <span role="img" aria-label={t("ImSettingsPanel.message74")}>
              <ArtemisIcon
                name="send"
                width={16}
                height={16}
                style={{
                  display: "inline-block",
                  verticalAlign: "text-bottom",
                }}
              />
            </span>
            {afterPairingIcon}
          </li>
        </ol>
      </details>
    </>
  );
}

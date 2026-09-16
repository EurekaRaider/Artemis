import type { ImTranslate } from "./ImNavigation";

export function ImPlatformSetup({
  channel,
  transport = "websocket",
  domain = "feishu",
  t: translate,
}: {
  channel: "feishu" | "wecom";
  transport?: string;
  domain?: string;
  t: ImTranslate;
}) {
  const feishu = channel === "feishu";
  const lark = feishu && domain === "lark";
  const origin = lark ? "https://open.larksuite.com" : "https://open.feishu.cn";
  const t: ImTranslate = (key, values) => {
    const text = translate(key, values);
    return lark
      ? text
          .replaceAll("飞书", "Lark")
          .replaceAll("飛書", "Lark")
          .replaceAll("Feishu", "Lark")
      : text;
  };
  return (
    <div className="im-platform-setup">
      <h4>{t("ImPlatformSetup.message1")}</h4>
      <p>
        {feishu ? t("ImPlatformSetup.message3") : t("ImPlatformSetup.message2")}
      </p>
      <div className="im-platform-help">
        <details>
          <summary>{t("ImPlatformSetup.message4")}</summary>
          <p>
            {feishu
              ? t("ImPlatformSetup.message6")
              : t("ImPlatformSetup.message5")}
          </p>
          <p>
            {feishu
              ? t("ImPlatformSetup.message8")
              : t("ImPlatformSetup.message7")}
          </p>
        </details>
        <details>
          <summary>{t("ImPlatformSetup.message9")}</summary>
          <ol className="im-platform-steps">
            {feishu ? (
              <>
                <li>{t("ImPlatformSetup.message13")}</li>
                <li>{t("ImPlatformSetup.message14")}</li>
                <li>
                  {transport === "webhook"
                    ? t("ImPlatformSetup.message16")
                    : t("ImPlatformSetup.message15")}
                </li>
                <li>{t("ImPlatformSetup.message17")}</li>
                <li>{t("ImPlatformSetup.message18")}</li>
                <li>{t("ImPlatformSetup.message19")}</li>
              </>
            ) : (
              <>
                <li>{t("ImPlatformSetup.message10")}</li>
                <li>{t("ImPlatformSetup.message11")}</li>
                <li>{t("ImPlatformSetup.message12")}</li>
              </>
            )}
          </ol>
        </details>
      </div>
      <div className="im-setup-links">
        <a
          href={feishu ? `${origin}/app` : "https://work.weixin.qq.com/"}
          target="_blank"
          rel="noreferrer"
        >
          {feishu
            ? lark
              ? t("ImPlatformSetup.message22")
              : t("ImPlatformSetup.message21")
            : t("ImPlatformSetup.message20")}
        </a>
        <a
          href={
            feishu
              ? `${origin}/document/home/develop-a-bot-in-5-minutes/create-an-app`
              : "https://cloud.tencent.cn/document/product/1831/137051"
          }
          target="_blank"
          rel="noreferrer"
        >
          {t("ImPlatformSetup.message23")}
        </a>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type {
  ImFeishuScanBeginResult,
  ImFeishuScanPollResult,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { InlineNotice } from "@artemis/ui/feedback";
import type { ImTranslate } from "./ImNavigation.js";

/**
 * Feishu scan-to-register: the official OAuth app registration device flow.
 * Scan → confirm on the phone → the app is minted, its credentials are saved
 * through the same connection channel as the manual form, and the bot
 * connects over the websocket transport. No developer-console visit needed.
 */
type ImFeishuScanPhase =
  | { stage: "idle" }
  | { stage: "scanning"; image: string; begin: ImFeishuScanBeginResult }
  | { stage: "connecting"; image: string }
  | { stage: "done"; name?: string }
  | { stage: "failed"; message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ImFeishuScan({
  t,
  busy,
  disabled,
  onConnected,
}: {
  t: ImTranslate;
  busy: boolean;
  disabled: boolean;
  onConnected: () => void;
}) {
  const [phase, setPhase] = useState<ImFeishuScanPhase>({ stage: "idle" });
  // Incremented to invalidate in-flight polls after cancel/unmount; timers
  // from a stale epoch are ignored instead of unmounted mid-request.
  const epoch = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      epoch.current += 1;
      window.clearTimeout(timer.current);
    },
    [],
  );

  const poll = (
    run: number,
    begin: ImFeishuScanBeginResult,
    domain: "feishu" | "lark",
    delay: number,
  ) => {
    timer.current = window.setTimeout(
      () => void pollOnce(run, begin, domain),
      Math.max(delay, 0),
    );
  };
  const pollOnce = async (
    run: number,
    begin: ImFeishuScanBeginResult,
    domain: "feishu" | "lark",
  ) => {
    if (epoch.current !== run) return;
    if (Date.now() > begin.expiresAt) {
      setPhase({ stage: "failed", message: t("ImFeishuScan.message6") });
      return;
    }
    let result: ImFeishuScanPollResult;
    try {
      result = (await window.artemis.manageIm({
        action: "feishu-scan-poll",
        deviceCode: begin.deviceCode,
        domain,
      })) as ImFeishuScanPollResult;
    } catch (error) {
      setPhase({ stage: "failed", message: messageOf(error) });
      return;
    }
    if (epoch.current !== run) return;
    if (result.status === "pending") {
      poll(run, begin, result.domain, result.intervalMs);
      return;
    }
    if (result.status === "success") {
      setPhase((previous) => ({
        stage: "connecting",
        image: previous.stage === "scanning" ? previous.image : "",
      }));
      try {
        await window.artemis.manageIm({
          action: "feishu-scan-connect",
          appId: result.appId,
          appSecret: result.appSecret,
          appName: result.appName,
          domain: result.domain,
          tenantId: result.tenantKey,
        });
      } catch (error) {
        if (epoch.current !== run) return;
        setPhase({ stage: "failed", message: messageOf(error) });
        return;
      }
      if (epoch.current !== run) return;
      setPhase(
        result.appName
          ? { stage: "done", name: result.appName }
          : { stage: "done" },
      );
      onConnected();
      return;
    }
    setPhase({
      stage: "failed",
      message:
        result.status === "error"
          ? result.message
          : t("ImFeishuScan.message6"),
    });
  };
  const start = () => {
    epoch.current += 1;
    window.clearTimeout(timer.current);
    const run = epoch.current;
    void (async () => {
      try {
        const begin = (await window.artemis.manageIm({
          action: "feishu-scan-begin",
        })) as ImFeishuScanBeginResult;
        if (epoch.current !== run) return;
        const image = await QRCode.toDataURL(begin.qrUrl, {
          width: 176,
          margin: 1,
        });
        if (epoch.current !== run) return;
        setPhase({ stage: "scanning", image, begin });
        poll(run, begin, begin.domain, begin.intervalMs);
      } catch (error) {
        if (epoch.current !== run) return;
        setPhase({ stage: "failed", message: messageOf(error) });
      }
    })();
  };
  const cancel = () => {
    epoch.current += 1;
    window.clearTimeout(timer.current);
    setPhase({ stage: "idle" });
  };

  if (phase.stage === "done")
    return (
      <div className="im-scan">
        <InlineNotice tone="success">
          {t("ImFeishuScan.message5", { name: phase.name ?? "Feishu" })}
        </InlineNotice>
      </div>
    );
  if (phase.stage === "failed")
    return (
      <div className="im-scan">
        <InlineNotice tone="danger">{phase.message}</InlineNotice>
        <Button
          size="compact"
          variant="quiet"
          disabled={busy || disabled}
          onClick={start}
        >
          {t("ImFeishuScan.message3")}
        </Button>
      </div>
    );
  if (phase.stage === "idle")
    return (
      <div className="im-scan">
        <div className="im-scan-copy">
          <h4>{t("ImFeishuScan.message1")}</h4>
          <p className="im-fine">{t("ImFeishuScan.message2")}</p>
        </div>
        <Button
          size="compact"
          disabled={busy || disabled}
          onClick={start}
        >
          {t("ImFeishuScan.message3")}
        </Button>
      </div>
    );
  const image = phase.image;
  return (
    <div className="im-scan im-scan-active">
      {image ? (
        <img
          className="im-scan-qr"
          src={image}
          alt={t("ImFeishuScan.message1")}
        />
      ) : null}
      <div className="im-scan-copy">
        <p>{t("ImFeishuScan.message4")}</p>
        <Button size="compact" variant="quiet" onClick={cancel}>
          {t("ImFeishuScan.message9")}
        </Button>
      </div>
    </div>
  );
}

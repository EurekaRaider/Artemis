import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type {
  ImFeishuScanBeginResult,
  ImFeishuScanPollResult,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";
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
  autoStart = false,
  bare = false,
  refreshSignal = 0,
  t,
  busy,
  disabled,
  onConnected,
  onIdle,
}: {
  t: ImTranslate;
  /** 渠道详情打开即触发扫码（ZCode 动线：点渠道 = 出二维码）。 */
  autoStart?: boolean;
  /** 卡片自带「扫码」触发钮的宿主用：idle 不渲染独立扫码卡。 */
  bare?: boolean;
  /** 递增即原位更换二维码（轮询作废重开，卡片不卸载）。 */
  refreshSignal?: number;
  busy: boolean;
  disabled: boolean;
  /** 扫码建连成功后携带新连接 id，供面板接续配对引导（ZCode 同款动线）。 */
  onConnected: (connectionId?: string) => void;
  /** 取消扫码时通知宿主（bare 卡片体随之隐藏，可由扫码钮重开）。 */
  onIdle?: () => void;
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
      let savedConnectionId: string | undefined;
      setPhase((previous) => ({
        stage: "connecting",
        image: previous.stage === "scanning" ? previous.image : "",
      }));
      try {
        const saved = (await window.artemis.manageIm({
          action: "feishu-scan-connect",
          appId: result.appId,
          appSecret: result.appSecret,
          appName: result.appName,
          domain: result.domain,
          tenantId: result.tenantKey,
        })) as { connectionId?: string };
        savedConnectionId = saved.connectionId;
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
      onConnected(savedConnectionId);
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
    onIdle?.();
  };
  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      start();
    }
    // 仅在挂载/解锁自动触发时执行一次；start 捕获当前闭包即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);
  // 「扫码」钮的局部刷新：递增信号触发原位重开，旧码保留至新码就绪。
  const lastRefresh = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal !== lastRefresh.current) {
      lastRefresh.current = refreshSignal;
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

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
    {
      if (bare) return null;
      return (
        <div className="im-scan">
          <div className="im-scan-copy">
            <h4>{t("ImFeishuScan.message1")}</h4>
            <p className="im-fine">{t("ImFeishuScan.message2")}</p>
          </div>
          <Button
            size="compact"
            variant="secondary"
            disabled={busy || disabled}
            onClick={start}
          >
            <ArtemisIcon aria-hidden="true" height={14} name="qr-code" width={14} />
            {t("ImFeishuScan.message10")}
          </Button>
        </div>
      );
    }
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
        <p>{t("ImFeishuScan.message11")}</p>
        {phase.stage === "scanning" && phase.begin.userCode ? (
          <div className="im-scan-code">
            <code>{phase.begin.userCode}</code>
          </div>
        ) : null}
        <p className="im-scan-wait">
          <span aria-hidden="true" className="im-scan-spinner" />
          {t("ImFeishuScan.message4")}
          <Button
            size="compact"
            variant="quiet"
            className="im-scan-cancel"
            onClick={cancel}
          >
            {t("ImFeishuScan.message9")}
          </Button>
        </p>
      </div>
    </div>
  );
}

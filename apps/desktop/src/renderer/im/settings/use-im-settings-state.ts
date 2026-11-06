import { type Status, type BotMetadata } from "./im-settings-values.js";
import { uiTranslator } from "../../../shared/i18n/ui-text.js";

import { useRef, useState } from "react";

import { type ImSettings, type Project } from "@artemis/protocol";

import { type ImFlowStepId, type ImVerifyState } from "../im-flow-derive";
import { type ImChannel } from "../ImNavigation";

import { type ImPairCode } from "../ImAccountControls";

interface UseImSettingsStateContext {
  readonly locale:
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW";
  readonly initialPermissions: boolean;
}
export function useImSettingsState(context: UseImSettingsStateContext) {
  const { locale, initialPermissions } = context;
  const t = uiTranslator(locale);
  const [status, setStatus] = useState<Status>();
  const [settings, setSettings] = useState<ImSettings>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("Artemis");
  const [adminToken, setAdminToken] = useState("");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);

  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const refreshEpoch = useRef(0);
  const [refreshError, setRefreshError] = useState("");
  const [pairCode, setPairCode] = useState<ImPairCode>();
  const [screen, setScreen] = useState<"flow" | "overview" | undefined>(
    initialPermissions ? "overview" : undefined,
  );
  /* 凭据表单收敛进弹窗：null 关闭；{} 新建；{ connectionId } 更换该连接。 */
  const [botDialog, setBotDialog] = useState<{ connectionId?: string } | null>(
    null,
  );
  const botDialogTrigger = useRef<HTMLButtonElement>(null);
  /* 配对码弹窗：从某条机器人行打开（记录连接 id）。 */
  const [pairDialogId, setPairDialogId] = useState("");
  const pairDialogTrigger = useRef<HTMLButtonElement>(null);
  const [connectionId, setConnectionId] = useState("");
  const [compact, setCompact] = useState(false);
  const [focusTarget, setFocusTarget] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const [channel, setChannel] = useState<ImChannel>("slack");
  /* 两栏布局：右栏渠道列表 ↔ 单渠道详情（下钻）。 */
  const [channelDetail, setChannelDetail] = useState(false);
  /* 右栏第三卡：群协作详情（与渠道详情互斥）。 */
  const [groupDetail, setGroupDetail] = useState(initialPermissions);
  const [showRemote, setShowRemote] = useState(false);
  const [advancedDetail, setAdvancedDetail] = useState(false);
  /* 渠道二级面板（ZCode 式主从）：右栏 = 选中机器人详情 / 新建表单 /
     指引 / 导入 / 验证。 */
  const [channelPane, setChannelPane] = useState<
    "bot" | "create" | "guide" | "import" | "verify"
  >("bot");
  const [selectedBotId, setSelectedBotId] = useState("");
  /* 关联凭据卡的飞书扫码开合（ZCode 式：卡头「扫码」钮展开二维码）。 */
  const [credScan, setCredScan] = useState(false);
  /* 渠道弹窗高度跟随「消息接入」主弹窗实际渲染高度（打开时量测注入）。 */
  const [channelDialogHeight, setChannelDialogHeight] = useState<number>();
  /* 飞书创建页的扫码轮次：头部「扫码」钮递增重挂组件以更换二维码。 */
  const [createScanEpoch, setCreateScanEpoch] = useState(0);
  /* 创建页扫码卡体开合：取消隐藏，卡头「扫码」钮重新展开。 */
  const [createScanOpen, setCreateScanOpen] = useState(true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [diagnostics, setDiagnostics] = useState<unknown>();
  const [savedMetadata, setSavedMetadata] = useState<
    Partial<Record<ImChannel, BotMetadata>>
  >({});
  const [savingChannel, setSavingChannel] = useState<ImChannel | null>(null);
  const [savedPending, setSavedPending] = useState<
    Partial<Record<ImChannel, boolean>>
  >({});
  const groupDialogTrigger = useRef<HTMLButtonElement | null>(null);
  const [flowCard, setFlowCard] = useState<ImFlowStepId | null>(null);
  /* ②尾「顺手验证」折叠段：imReadVerify 恢复确认态；开合本次会话内记住
     （首绑自动展开一次，用户手动开合后不再抢开）。 */
  const [verify, setVerify] = useState<ImVerifyState>({ confirmed: false });
  const verifyTouched = useRef(false);
  const [taskSeen, setTaskSeen] = useState(false);
  return {
    t,
    status,
    setStatus,
    settings,
    setSettings,
    projects,
    setProjects,
    url,
    setUrl,
    name,
    setName,
    adminToken,
    setAdminToken,
    message,
    setMessage,
    messageError,
    setMessageError,
    busy,
    setBusy,
    running,
    refreshEpoch,
    refreshError,
    setRefreshError,
    pairCode,
    setPairCode,
    screen,
    setScreen,
    botDialog,
    setBotDialog,
    botDialogTrigger,
    pairDialogId,
    setPairDialogId,
    pairDialogTrigger,
    connectionId,
    setConnectionId,
    compact,
    setCompact,
    focusTarget,
    setFocusTarget,
    panelRef,
    mounted,
    channel,
    setChannel,
    channelDetail,
    setChannelDetail,
    groupDetail,
    setGroupDetail,
    showRemote,
    setShowRemote,
    advancedDetail,
    setAdvancedDetail,
    channelPane,
    setChannelPane,
    selectedBotId,
    setSelectedBotId,
    credScan,
    setCredScan,
    channelDialogHeight,
    setChannelDialogHeight,
    createScanEpoch,
    setCreateScanEpoch,
    createScanOpen,
    setCreateScanOpen,
    fields,
    setFields,
    diagnostics,
    setDiagnostics,
    savedMetadata,
    setSavedMetadata,
    setSavingChannel,
    savedPending,
    setSavedPending,
    groupDialogTrigger,
    flowCard,
    setFlowCard,
    verify,
    setVerify,
    verifyTouched,
    taskSeen,
    setTaskSeen,
  };
}

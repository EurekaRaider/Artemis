import type { AppLocale } from "@artemis/protocol";

export function timelinePreviewCopy(locale: AppLocale) {
  return locale.startsWith("zh")
    ? {
        open: "在右侧打开",
        loading: "正在加载预览…",
        failed: "无法预览此内容",
        retry: "重试",
        enlarge: "放大查看",
        close: "关闭",
        source: "查看源码",
        copy: "复制源码",
        copied: "已复制",
        copyFailed: "复制失败，请重试",
        diagram: "图表",
        audioFailed: "无法播放此音频，请检查文件或编码格式。",
        refresh: "刷新预览",
        htmlNote: "交互预览 · 仅加载当前目录内的脚本、样式和图片",
      }
    : {
        open: "Open in side panel",
        loading: "Loading preview…",
        failed: "Preview unavailable",
        retry: "Retry",
        enlarge: "Enlarge",
        close: "Close",
        source: "View source",
        copy: "Copy source",
        copied: "Copied",
        copyFailed: "Copy failed; retry",
        diagram: "Diagram",
        audioFailed:
          "This audio cannot be played. Check the file or its encoding.",
        refresh: "Refresh preview",
        htmlNote:
          "Interactive preview · Scripts, styles and images from this directory only",
      };
}

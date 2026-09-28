import type { AppLocale } from "@artemis/protocol";
export function officeEditCopy(locale: AppLocale) {
  return locale.startsWith("zh")
    ? {
        copy: "自动保存到工作副本，原文件保留",
        destination: "保存位置",
        text: "编辑文字",
        pending: "待保存",
        hint: "单击文字编辑；拖动空白区域添加批注。",
      }
    : {
        copy: "Autosave uses a working copy; the source is preserved",
        destination: "Saved to",
        text: "Edit text",
        pending: "Unsaved changes",
        hint: "Click text to edit; drag a blank area to comment.",
      };
}

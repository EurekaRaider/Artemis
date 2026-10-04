import type { AppLocale } from "@artemis/protocol";

const copy: Record<AppLocale, readonly [string, string, string]> = {
  en: ["Clear selection", "Dismiss error", "Press Esc to cancel selection."],
  "zh-CN": ["清除选区", "关闭错误提示", "按 Esc 取消选择。"],
  "zh-TW": ["清除選取範圍", "關閉錯誤提示", "按 Esc 取消選取。"],
  ja: ["選択を解除", "エラーを閉じる", "Esc キーで選択を解除します。"],
  ko: ["선택 해제", "오류 닫기", "Esc 키를 눌러 선택을 취소하세요."],
  fr: [
    "Effacer la sélection",
    "Fermer l’erreur",
    "Échap pour annuler la sélection.",
  ],
  de: [
    "Auswahl aufheben",
    "Fehler schließen",
    "Esc drücken, um die Auswahl aufzuheben.",
  ],
  es: [
    "Borrar selección",
    "Cerrar error",
    "Pulsa Esc para cancelar la selección.",
  ],
  "pt-BR": [
    "Limpar seleção",
    "Fechar erro",
    "Pressione Esc para cancelar a seleção.",
  ],
  it: [
    "Cancella selezione",
    "Chiudi errore",
    "Premi Esc per annullare la selezione.",
  ],
  ru: [
    "Снять выделение",
    "Закрыть ошибку",
    "Нажмите Esc для отмены выделения.",
  ],
  ar: ["مسح التحديد", "إغلاق الخطأ", "اضغط Esc لإلغاء التحديد."],
  hi: ["चयन हटाएँ", "त्रुटि बंद करें", "चयन रद्द करने के लिए Esc दबाएँ।"],
  id: [
    "Hapus pilihan",
    "Tutup kesalahan",
    "Tekan Esc untuk membatalkan pilihan.",
  ],
};
export function officeReviewCopy(locale: AppLocale) {
  const [clearSelection, dismissError, escape] = copy[locale];
  return { clearSelection, dismissError, escape };
}

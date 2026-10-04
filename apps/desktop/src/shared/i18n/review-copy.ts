import type { AppLocale } from "@artemis/protocol";

const REVIEW_MESSAGES: Record<AppLocale, readonly string[]> = {
  en: [
    "Project not found.",
    "Temporary conversations do not have a project review.",
    "Turn review is unavailable.",
    "This turn does not have a persisted change set.",
    "The task-period workspace changes were undone.",
  ],
  "zh-CN": [
    "找不到项目。",
    "临时会话没有项目审查视图。",
    "本轮审查不可用。",
    "本轮没有已保存的变更集。",
    "任务期间的工作区变更已撤销。",
  ],
  "zh-TW": [
    "找不到專案。",
    "臨時對話沒有專案審查檢視。",
    "本輪審查無法使用。",
    "本輪沒有已儲存的變更集。",
    "任務期間的工作區變更已復原。",
  ],
  ja: [
    "プロジェクトが見つかりません。",
    "一時的な会話にはプロジェクトのレビューがありません。",
    "このターンのレビューは利用できません。",
    "このターンには保存済みの変更セットがありません。",
    "タスク中のワークスペースの変更を元に戻しました。",
  ],
  ko: [
    "프로젝트를 찾을 수 없습니다.",
    "임시 대화에는 프로젝트 검토가 없습니다.",
    "이 턴의 검토를 사용할 수 없습니다.",
    "이 턴에는 저장된 변경 집합이 없습니다.",
    "작업 중 발생한 작업 공간 변경 사항을 실행 취소했습니다.",
  ],
  es: [
    "No se encontró el proyecto.",
    "Las conversaciones temporales no tienen revisión de proyecto.",
    "La revisión de este turno no está disponible.",
    "Este turno no tiene un conjunto de cambios guardado.",
    "Se deshicieron los cambios del espacio de trabajo realizados durante la tarea.",
  ],
  fr: [
    "Projet introuvable.",
    "Les conversations temporaires ne disposent pas de revue de projet.",
    "La revue de ce tour n’est pas disponible.",
    "Ce tour ne possède aucun ensemble de modifications enregistré.",
    "Les modifications de l’espace de travail effectuées pendant la tâche ont été annulées.",
  ],
  de: [
    "Projekt nicht gefunden.",
    "Temporäre Unterhaltungen haben keine Projektprüfung.",
    "Die Prüfung dieses Durchlaufs ist nicht verfügbar.",
    "Für diesen Durchlauf sind keine Änderungen gespeichert.",
    "Die Änderungen am Arbeitsbereich während der Aufgabe wurden rückgängig gemacht.",
  ],
  "pt-BR": [
    "Projeto não encontrado.",
    "Conversas temporárias não têm revisão de projeto.",
    "A revisão deste turno não está disponível.",
    "Este turno não tem um conjunto de alterações salvo.",
    "As alterações no espaço de trabalho feitas durante a tarefa foram desfeitas.",
  ],
  it: [
    "Progetto non trovato.",
    "Le conversazioni temporanee non hanno una revisione del progetto.",
    "La revisione di questo turno non è disponibile.",
    "Questo turno non ha un insieme di modifiche salvato.",
    "Le modifiche all’area di lavoro effettuate durante l’attività sono state annullate.",
  ],
  ru: [
    "Проект не найден.",
    "Во временных диалогах нет проверки проекта.",
    "Проверка этого хода недоступна.",
    "Для этого хода нет сохранённого набора изменений.",
    "Изменения рабочего пространства за время задачи отменены.",
  ],
  ar: [
    "لم يتم العثور على المشروع.",
    "لا تتوفر مراجعة للمشروع في المحادثات المؤقتة.",
    "مراجعة هذه الجولة غير متاحة.",
    "لا توجد مجموعة تغييرات محفوظة لهذه الجولة.",
    "تم التراجع عن تغييرات مساحة العمل التي أُجريت أثناء المهمة.",
  ],
  hi: [
    "प्रोजेक्ट नहीं मिला।",
    "अस्थायी बातचीत में प्रोजेक्ट की समीक्षा उपलब्ध नहीं है।",
    "इस टर्न की समीक्षा उपलब्ध नहीं है।",
    "इस टर्न के लिए बदलावों का कोई सेट सहेजा नहीं गया है।",
    "कार्य के दौरान वर्कस्पेस में किए गए बदलाव वापस कर दिए गए हैं।",
  ],
  id: [
    "Proyek tidak ditemukan.",
    "Percakapan sementara tidak memiliki tinjauan proyek.",
    "Tinjauan giliran ini tidak tersedia.",
    "Giliran ini tidak memiliki kumpulan perubahan yang tersimpan.",
    "Perubahan ruang kerja selama tugas telah dibatalkan.",
  ],
};

export function reviewMessage(locale: AppLocale, message: string): string {
  const index = REVIEW_MESSAGES.en.indexOf(message);
  return index < 0 ? message : REVIEW_MESSAGES[locale][index]!;
}

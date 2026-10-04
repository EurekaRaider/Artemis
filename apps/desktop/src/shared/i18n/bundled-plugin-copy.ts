import type { AppLocale } from "@artemis/protocol";

const BUNDLED_DESCRIPTIONS: Record<
  AppLocale,
  { office: string; advancedOffice: string; pdf: string }
> = {
  en: {
    office: "Basic {{format}} document reading and writing.",
    advancedOffice: "Advanced {{format}} document reading and editing.",
    pdf: "Read PDF text and create text-based PDFs.",
  },
  "zh-CN": {
    office: "提供基础的 {{format}} 文档读写。",
    advancedOffice: "提供高级的 {{format}} 文档读写与编辑功能。",
    pdf: "读取 PDF 文本内容，创建文本 PDF 文档。",
  },
  "zh-TW": {
    office: "提供基本的 {{format}} 文件讀寫。",
    advancedOffice: "提供進階的 {{format}} 文件讀寫與編輯功能。",
    pdf: "讀取 PDF 文字內容，建立文字 PDF 文件。",
  },
  ja: {
    office: "{{format}} 文書の基本的な読み書きができます。",
    advancedOffice: "{{format}} 文書の高度な読み取り・編集機能を提供します。",
    pdf: "PDF のテキストを読み取り、テキスト PDF を作成します。",
  },
  ko: {
    office: "기본적인 {{format}} 문서 읽기 및 쓰기를 제공합니다.",
    advancedOffice: "고급 {{format}} 문서 읽기 및 편집 기능을 제공합니다.",
    pdf: "PDF 텍스트를 읽고 텍스트 기반 PDF를 생성합니다.",
  },
  es: {
    office: "Lectura y escritura básicas de documentos {{format}}.",
    advancedOffice:
      "Funciones avanzadas de lectura y edición de documentos {{format}}.",
    pdf: "Lee texto de PDF y crea PDF de texto.",
  },
  fr: {
    office: "Lecture et écriture de base de documents {{format}}.",
    advancedOffice:
      "Fonctions avancées de lecture et de modification de documents {{format}}.",
    pdf: "Lisez le texte des PDF et créez des PDF textuels.",
  },
  de: {
    office: "Grundlegendes Lesen und Schreiben von {{format}}-Dokumenten.",
    advancedOffice:
      "Erweiterte Funktionen zum Lesen und Bearbeiten von {{format}}-Dokumenten.",
    pdf: "PDF-Text lesen und textbasierte PDFs erstellen.",
  },
  "pt-BR": {
    office: "Leitura e escrita básicas de documentos {{format}}.",
    advancedOffice:
      "Recursos avançados de leitura e edição de documentos {{format}}.",
    pdf: "Leia texto de PDFs e crie PDFs de texto.",
  },
  it: {
    office: "Lettura e scrittura di base di documenti {{format}}.",
    advancedOffice:
      "Funzioni avanzate di lettura e modifica di documenti {{format}}.",
    pdf: "Leggi il testo dei PDF e crea PDF testuali.",
  },
  ru: {
    office: "Базовое чтение и запись документов {{format}}.",
    advancedOffice:
      "Расширенные возможности чтения и редактирования документов {{format}}.",
    pdf: "Чтение текста PDF и создание текстовых PDF.",
  },
  ar: {
    office: "قراءة مستندات {{format}} وكتابتها بالوظائف الأساسية.",
    advancedOffice: "ميزات متقدمة لقراءة مستندات {{format}} وتحريرها.",
    pdf: "قراءة نصوص PDF وإنشاء ملفات PDF نصية.",
  },
  hi: {
    office: "{{format}} दस्तावेज़ पढ़ने और लिखने की बुनियादी सुविधाएँ।",
    advancedOffice:
      "{{format}} दस्तावेज़ पढ़ने और संपादित करने की उन्नत सुविधाएँ।",
    pdf: "PDF का टेक्स्ट पढ़ें और टेक्स्ट PDF बनाएँ।",
  },
  id: {
    office: "Fitur dasar untuk membaca dan menulis dokumen {{format}}.",
    advancedOffice:
      "Fitur lanjutan untuk membaca dan mengedit dokumen {{format}}.",
    pdf: "Baca teks PDF dan buat PDF berbasis teks.",
  },
};

export function bundledPluginDescription(
  locale: AppLocale,
  name: string,
  officeActive = false,
): string | undefined {
  if (name === "pdf") return BUNDLED_DESCRIPTIONS[locale].pdf;
  const format = (
    {
      documents: "Word",
      presentations: "PowerPoint",
      spreadsheets: "Excel",
    } as Record<string, string>
  )[name];
  return format
    ? BUNDLED_DESCRIPTIONS[locale][
        officeActive ? "advancedOffice" : "office"
      ].replace("{{format}}", format)
    : undefined;
}

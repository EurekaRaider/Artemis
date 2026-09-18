import type { AppLocale } from "@artemis/protocol";

const BUNDLED_DESCRIPTIONS: Record<AppLocale, { office: string; pdf: string }> =
  {
    en: {
      office: "Basic {{format}} document reading and writing.",
      pdf: "Basic text PDF reading and writing.",
    },
    "zh-CN": {
      office: "提供基础的 {{format}} 文档读写。",
      pdf: "提供基础的文本 PDF 读写。",
    },
    "zh-TW": {
      office: "提供基本的 {{format}} 文件讀寫。",
      pdf: "提供基本的文字 PDF 讀寫。",
    },
    ja: {
      office: "{{format}} 文書の基本的な読み書きができます。",
      pdf: "テキスト PDF の基本的な読み書きができます。",
    },
    ko: {
      office: "기본적인 {{format}} 문서 읽기 및 쓰기를 제공합니다.",
      pdf: "기본적인 텍스트 PDF 읽기 및 쓰기를 제공합니다.",
    },
    es: {
      office: "Lectura y escritura básicas de documentos {{format}}.",
      pdf: "Lectura y escritura básicas de PDF de texto.",
    },
    fr: {
      office: "Lecture et écriture de base de documents {{format}}.",
      pdf: "Lecture et écriture de base de PDF textuels.",
    },
    de: {
      office: "Grundlegendes Lesen und Schreiben von {{format}}-Dokumenten.",
      pdf: "Grundlegendes Lesen und Schreiben textbasierter PDFs.",
    },
    "pt-BR": {
      office: "Leitura e escrita básicas de documentos {{format}}.",
      pdf: "Leitura e escrita básicas de PDFs de texto.",
    },
    it: {
      office: "Lettura e scrittura di base di documenti {{format}}.",
      pdf: "Lettura e scrittura di base di PDF testuali.",
    },
    ru: {
      office: "Базовое чтение и запись документов {{format}}.",
      pdf: "Базовое чтение и запись текстовых PDF.",
    },
    ar: {
      office: "قراءة مستندات {{format}} وكتابتها بالوظائف الأساسية.",
      pdf: "قراءة ملفات PDF النصية وكتابتها بالوظائف الأساسية.",
    },
    hi: {
      office: "{{format}} दस्तावेज़ पढ़ने और लिखने की बुनियादी सुविधाएँ।",
      pdf: "टेक्स्ट PDF पढ़ने और लिखने की बुनियादी सुविधाएँ।",
    },
    id: {
      office: "Fitur dasar untuk membaca dan menulis dokumen {{format}}.",
      pdf: "Fitur dasar untuk membaca dan menulis PDF berbasis teks.",
    },
  };

export function bundledPluginDescription(
  locale: AppLocale,
  name: string,
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
    ? BUNDLED_DESCRIPTIONS[locale].office.replace("{{format}}", format)
    : undefined;
}

import type { AppLocale } from "@artemis/protocol";

const BUNDLED_DESCRIPTIONS: Record<AppLocale, { office: string; pdf: string }> =
  {
    en: {
      office:
        "Basic {{format}} document reading and writing, with no Codex runtime required.",
      pdf: "Basic text PDF reading and writing, with no Codex runtime required.",
    },
    "zh-CN": {
      office: "提供基础的 {{format}} 文档读写，无需 Codex 运行时。",
      pdf: "提供基础的文本 PDF 读写，无需 Codex 运行时。",
    },
    "zh-TW": {
      office: "提供基本的 {{format}} 文件讀寫，無需 Codex 執行環境。",
      pdf: "提供基本的文字 PDF 讀寫，無需 Codex 執行環境。",
    },
    ja: {
      office:
        "Codex ランタイムなしで、{{format}} 文書の基本的な読み書きができます。",
      pdf: "Codex ランタイムなしで、テキスト PDF の基本的な読み書きができます。",
    },
    ko: {
      office:
        "Codex 런타임 없이 기본적인 {{format}} 문서 읽기 및 쓰기를 제공합니다.",
      pdf: "Codex 런타임 없이 기본적인 텍스트 PDF 읽기 및 쓰기를 제공합니다.",
    },
    es: {
      office:
        "Lectura y escritura básicas de documentos {{format}}, sin necesidad del entorno de ejecución de Codex.",
      pdf: "Lectura y escritura básicas de PDF de texto, sin necesidad del entorno de ejecución de Codex.",
    },
    fr: {
      office:
        "Lecture et écriture de base de documents {{format}}, sans environnement d’exécution Codex.",
      pdf: "Lecture et écriture de base de PDF textuels, sans environnement d’exécution Codex.",
    },
    de: {
      office:
        "Grundlegendes Lesen und Schreiben von {{format}}-Dokumenten ohne Codex-Laufzeitumgebung.",
      pdf: "Grundlegendes Lesen und Schreiben textbasierter PDFs ohne Codex-Laufzeitumgebung.",
    },
    "pt-BR": {
      office:
        "Leitura e escrita básicas de documentos {{format}}, sem necessidade do ambiente de execução do Codex.",
      pdf: "Leitura e escrita básicas de PDFs de texto, sem necessidade do ambiente de execução do Codex.",
    },
    it: {
      office:
        "Lettura e scrittura di base di documenti {{format}}, senza l’ambiente di esecuzione Codex.",
      pdf: "Lettura e scrittura di base di PDF testuali, senza l’ambiente di esecuzione Codex.",
    },
    ru: {
      office:
        "Базовое чтение и запись документов {{format}} без среды выполнения Codex.",
      pdf: "Базовое чтение и запись текстовых PDF без среды выполнения Codex.",
    },
    ar: {
      office:
        "قراءة مستندات {{format}} وكتابتها بالوظائف الأساسية، دون الحاجة إلى بيئة تشغيل Codex.",
      pdf: "قراءة ملفات PDF النصية وكتابتها بالوظائف الأساسية، دون الحاجة إلى بيئة تشغيل Codex.",
    },
    hi: {
      office:
        "Codex रनटाइम के बिना {{format}} दस्तावेज़ पढ़ने और लिखने की बुनियादी सुविधाएँ।",
      pdf: "Codex रनटाइम के बिना टेक्स्ट PDF पढ़ने और लिखने की बुनियादी सुविधाएँ।",
    },
    id: {
      office:
        "Fitur dasar untuk membaca dan menulis dokumen {{format}}, tanpa memerlukan runtime Codex.",
      pdf: "Fitur dasar untuk membaca dan menulis PDF berbasis teks, tanpa memerlukan runtime Codex.",
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

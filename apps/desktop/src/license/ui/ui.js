import { messages } from "./locales.js";
const $ = (id) => document.getElementById(id);
const localeNames = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-BR": "Português (Brasil)",
  it: "Italiano",
  ru: "Русский",
  ar: "العربية",
  hi: "हिन्दी",
  id: "Bahasa Indonesia",
};
function resolveLocale(value) {
  if (messages[value]) return value;
  if (/^zh-(TW|HK|MO|Hant)/i.test(value)) return "zh-TW";
  if (/^zh\b/i.test(value)) return "zh-CN";
  if (/^pt\b/i.test(value)) return "pt-BR";
  return messages[value?.split("-")[0]] ? value.split("-")[0] : "en";
}
let saved;
try {
  saved = localStorage.getItem("artemis-license-language");
} catch {
  /* System language remains available when storage is disabled. */
}
let locale = resolveLocale(saved || navigator.language);
let current;
let statusKey = "loading";
function render() {
  const copy = messages[locale];
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  document.title = `Artemis · ${copy.title}`;
  $("language").value = locale;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = copy[element.dataset.i18n];
  });
  $("token").placeholder = copy.placeholder;
  $("status").textContent = copy[statusKey] ?? copy.failure;
  $("expiry").textContent = current?.expiresAt
    ? copy.expiry.replace(
        "{date}",
        new Date(current.expiresAt).toLocaleString(locale),
      )
    : "";
}
for (const [value, label] of Object.entries(localeNames)) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  $("language").append(option);
}
$("language").onchange = () => {
  locale = resolveLocale($("language").value);
  try {
    localStorage.setItem("artemis-license-language", locale);
  } catch {
    /* Language selection still works for this window. */
  }
  render();
};
function show(value) {
  if (!value) return;
  current = value;
  $("device").value = value.device ?? "";
  statusKey = value.state;
  render();
}
async function run(action) {
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const result = await action();
    if (result?.state) show(result);
  } catch (error) {
    statusKey =
      Object.keys(messages.en).find(
        (key) => key.includes("_") && String(error).includes(key),
      ) ?? "failure";
    render();
  } finally {
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
$("activate").onsubmit = (e) => {
  e.preventDefault();
  void run(() => window.license.activate($("token").value));
};
$("copy").onclick = () =>
  run(async () => {
    await window.license.copyDevice();
    statusKey = "copied";
    render();
  });
$("import").onclick = () => run(() => window.license.importFile());
$("request").onclick = () =>
  run(async () => {
    await window.license.recovery();
    statusKey = "requested";
    render();
  });
$("recover").onclick = () =>
  run(() => window.license.recover($("recovery").value));
$("quit").onclick = () => window.license.quit();
render();
void run(() => window.license.status());
window.license.onStatus(show);

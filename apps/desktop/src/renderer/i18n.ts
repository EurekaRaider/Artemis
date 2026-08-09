import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { I18N_RESOURCES } from "../shared/i18n-resources.js";

void i18n.use(initReactI18next).init({
  resources: I18N_RESOURCES,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "app",
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export { i18n };

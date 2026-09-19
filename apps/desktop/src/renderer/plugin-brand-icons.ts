import atlassian from "./assets/plugin-brands/atlassian.png";
import figma from "./assets/plugin-brands/figma.png";
import github from "./assets/plugin-brands/github.png";
import gmail from "./assets/plugin-brands/gmail.png";
import googleWorkspace from "./assets/plugin-brands/google-workspace.png";
import linear from "./assets/plugin-brands/linear.png";
import notion from "./assets/plugin-brands/notion.png";
import outlook from "./assets/plugin-brands/outlook.png";
import qqMail from "./assets/plugin-brands/qq-mail.png";
import slack from "./assets/plugin-brands/slack.png";

const PLUGIN_BRAND_ICONS: Readonly<Record<string, string>> = {
  atlassian,
  figma,
  github,
  gmail,
  "google-workspace": googleWorkspace,
  linear,
  notion,
  outlook,
  "qq-mail": qqMail,
  slack,
};

export function pluginBrandIcon(pluginName: string): string | undefined {
  return Object.hasOwn(PLUGIN_BRAND_ICONS, pluginName)
    ? PLUGIN_BRAND_ICONS[pluginName]
    : undefined;
}

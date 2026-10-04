[English / 简体中文](localization.md)

# Localization maintenance

The app supports English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Brazilian Portuguese, Italian, Russian, Arabic, Hindi and Indonesian. Use Simplified Chinese and actual product behavior as the semantic reference, and update every language when changing visible copy.

## Content and implementation

- Put visible copy in language-indexed resources. Maintain shared terms separately from page-specific terms to avoid conflicting meanings. Do not reintroduce page-level Chinese/English branches or English fallback for missing translations.
- Use placeholders for dynamic values. Keep keys, empty-value constraints, placeholders and command parameters consistent across languages.
- Preserve user input, project names, filenames, external plugin metadata and original technical diagnostics. Do not disguise an unknown technical error as a fully translated product conclusion.
- Format dates, weekdays, numbers and durations for the current locale. Validate RTL layout and bidirectional isolation in Arabic. Copied commands must not include display-only direction-control characters.
- Automatic task titles must recognize older title formats. Changing language must refresh attachments, archive pages and other open views.
- Security and permission copy must match actual execution modes, scope, trust and system sandbox boundaries. Do not replace precise boundaries with vague phrases such as “complete access.”

## Verification

Type and resource checks cover keys, placeholders and technical identifiers in every language. Interaction checks cover switching languages, copying commands, settings forms, long text wrapping and RTL. Native-window evidence must include theme, language, dimensions, source version and data provenance.

Historical acceptance on 2026-09-16 covered archive pages in all 14 languages and representative German, Arabic and other settings/automation pages: 20 macOS development-build scenarios in total. This does not establish native-speaker review for later copy, Windows native-window acceptance, or acceptance of final installers.

Continue adding native-speaker reviews by language, Windows native visual checks and release-package validation. Temporary screenshots from earlier audits have expired. New evidence needs a traceable manifest; `/tmp` links are not durable attachments.

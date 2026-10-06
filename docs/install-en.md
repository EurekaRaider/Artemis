[English / 简体中文](install.md)

# Installing Artemis

## Choose a package

Only Windows x64 and macOS arm64 are supported. Official assets are available from [Artemis](https://github.com/EurekaRaider/Artemis/releases). No registration code or device activation is required.

## macOS arm64

Open the DMG, drag `Artemis.app` into Applications and launch it. For ZIP packages, extract the entire archive before moving the app into Applications. Official releases must be signed, notarized and stapled; removing the system quarantine attribute is not required. If macOS refuses to open the app, check download completeness and release acceptance evidence. Removing security attributes must not become the normal installation procedure.

## Windows x64

Prefer the per-user `.exe` installer, which does not require administrator privileges. Installed copies check a separate signed Windows update index. Installation restarts only after user confirmation, running tasks have ended and edits have been saved. Failed verification must prevent installation.

ZIP packages retain manual updates: extract the complete archive into an ordinary user-owned directory, quit the old app and run `Artemis.exe` from the new directory. Do not launch it inside the archive. To enable installed-app updates, install the NSIS package manually once. Existing userData and project files are not replaced with the installation directory.

Ed25519 verification establishes update-manifest and asset integrity; it does not imply Authenticode signing or SmartScreen reputation. System or enterprise execution policies may still block unsigned programs. Do not disable system protection to bypass them.

When refreshing the OpenAI or a custom GitHub plugin marketplace, Artemis downloads HTTPS repository archives directly through the system network stack. It does not invoke `git.exe`, so Git is not required on the user's computer. Corporate networks must allow `api.github.com` and the archive download addresses returned by GitHub. If networking is blocked, cached marketplaces remain available.

## Office suite

Open **Resources → Plugins → Bundled plugins → Office** and install the enhancement pack online or import a verified `.artemis-office` offline pack. This single installation enables Office features; no separate basic plugins are needed. Without an active pack, Office document operations and previews are unavailable. Uninstalling keeps documents and history.

## Model configuration

In Artemis settings, enter the Base URL, API Key and model ID from the service configuration already used in OpenCode. Set the message type to **Responses (/responses)**. Save the configuration, then choose the corresponding provider and model.

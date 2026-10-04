[English / 简体中文](README-zh-CN.md)

# image-size parser blocker

This directory supplies a local package named `image-size`: it preserves the exports required by downstream dependencies while refusing every image-parser entry point. The directory name `image-size-parser-blocker` describes that purpose; the package name remains `image-size` for dependency resolution.

Artemis generates text-only PowerPoint files. PptxGenJS 4.0.1 declares `image-size` as a dependency, but its distributed runtime does not import it for this workflow.

When this compatibility package was introduced, the published `image-size` 2.0.2 release was affected by GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq. This local replacement removes those image parsers from the installed attack surface while preserving expected exports. Every parser entry point fails closed.

Remove this override once PptxGenJS no longer declares `image-size`, or once a patched upstream release is available and has passed the Office document tests.

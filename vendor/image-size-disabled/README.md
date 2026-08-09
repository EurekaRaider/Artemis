# Disabled image-size compatibility package

Artemis generates text-only PowerPoint files. PptxGenJS 4.0.1 declares
`image-size` as a dependency, but its distributed runtime does not import it
for this workflow.

The latest published `image-size` release (2.0.2) is affected by
GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq. This local compatibility package
removes those image parsers from the installed attack surface while preserving
the exports expected by downstream code. Every parser entry point fails closed.

Remove this override once PptxGenJS no longer declares `image-size`, or once a
patched upstream release is available and has passed the Office document tests.

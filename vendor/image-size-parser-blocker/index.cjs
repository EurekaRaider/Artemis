"use strict";

function imageSize() {
  throw new Error(
    "Image dimension detection is disabled in Artemis because PowerPoint generation is text-only.",
  );
}

function noop() {}

module.exports = imageSize;
module.exports.default = imageSize;
module.exports.imageSize = imageSize;
module.exports.disableFS = noop;
module.exports.disableTypes = noop;
module.exports.setConcurrency = noop;
module.exports.types = [];

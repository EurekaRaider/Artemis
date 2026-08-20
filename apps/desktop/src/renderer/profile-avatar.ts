const PROFILE_AVATAR_SIZE = 256;
const PROFILE_AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const PROFILE_AVATAR_MAX_STORED_BYTES = 512 * 1024;
const PROFILE_AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("The profile image could not be read."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The profile image could not be read."));
    reader.readAsDataURL(blob);
  });
}

export async function prepareProfileAvatar(file: File): Promise<string> {
  if (!PROFILE_AVATAR_MIME_TYPES.has(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  if (file.size <= 0 || file.size > PROFILE_AVATAR_MAX_SOURCE_BYTES) {
    throw new Error("The source profile image must be 8 MiB or smaller.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error("The profile image dimensions are invalid.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = PROFILE_AVATAR_SIZE;
    canvas.height = PROFILE_AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The profile image could not be processed.");

    const sourceSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = (bitmap.width - sourceSize) / 2;
    const sourceY = (bitmap.height - sourceSize) / 2;
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      PROFILE_AVATAR_SIZE,
      PROFILE_AVATAR_SIZE,
    );

    const optimized = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82),
    );
    if (!optimized || optimized.size > PROFILE_AVATAR_MAX_STORED_BYTES) {
      throw new Error("The optimized profile image is too large.");
    }
    return blobDataUrl(optimized);
  } finally {
    bitmap.close();
  }
}

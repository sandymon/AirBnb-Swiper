const fs = require("fs");
const path = require("path");

const MAX_IMAGES = 50;
const DOWNLOAD_CONCURRENCY = 6;
const ALLOWED_HOST = "a0.muscache.com";

function sanitizeListingId(listingId) {
  return String(listingId).replace(/[^a-zA-Z0-9-_]/g, "");
}

function isAllowedImageUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.hostname !== ALLOWED_HOST) {
      return false;
    }

    return (
      /\/im\/pictures\/(?:hosting|prohost-api|miso)\//.test(url.pathname) ||
      /^\/im\/pictures\/[a-f0-9-]+\.(jpe?g|png|webp)$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function extensionFromUrl(urlString) {
  try {
    const ext = path.extname(new URL(urlString).pathname);
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext.toLowerCase())) {
      return ext.toLowerCase() === ".jpg" ? ".jpeg" : ext.toLowerCase();
    }
  } catch {
    // fall through
  }

  return ".jpeg";
}

async function cacheListingImages(root, listingId, urls = []) {
  const safeId = sanitizeListingId(listingId);
  if (!safeId) {
    throw new Error("Invalid listing id.");
  }

  const uniqueUrls = [...new Set(urls.filter(isAllowedImageUrl))].slice(0, MAX_IMAGES);
  if (!uniqueUrls.length) {
    return { localImages: [], map: {}, cached: 0 };
  }

  const listingDir = path.join(root, "images", safeId);
  await fs.promises.mkdir(listingDir, { recursive: true });

  // Preserve source ordering by writing each result into its original slot,
  // then dropping the gaps left by any failed downloads.
  const results = new Array(uniqueUrls.length).fill(null);

  async function downloadImage(index) {
    const remoteUrl = uniqueUrls[index];
    const fileName = `${index}${extensionFromUrl(remoteUrl)}`;
    const filePath = path.join(listingDir, fileName);

    try {
      const response = await fetch(remoteUrl, {
        headers: { "User-Agent": "StayScout/1.0" },
      });

      if (!response.ok) {
        return;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.promises.writeFile(filePath, buffer);
      results[index] = `/images/${safeId}/${fileName}`;
    } catch {
      // Skip images that fail to download; the rest still succeed.
    }
  }

  let cursor = 0;
  async function worker() {
    while (cursor < uniqueUrls.length) {
      const index = cursor;
      cursor += 1;
      await downloadImage(index);
    }
  }

  const workerCount = Math.min(DOWNLOAD_CONCURRENCY, uniqueUrls.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  // `map` lets callers resolve a specific remote URL to its cached local path (or
  // fall back to the remote URL when a download failed), instead of relying on
  // array position, which drifts once any download in the batch fails.
  const map = {};
  uniqueUrls.forEach((remoteUrl, index) => {
    if (results[index]) {
      map[remoteUrl] = results[index];
    }
  });

  const localImages = results.filter(Boolean);
  return { localImages, map, cached: localImages.length };
}

module.exports = {
  cacheListingImages,
  sanitizeListingId,
};

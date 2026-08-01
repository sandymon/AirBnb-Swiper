if (!globalThis.__stayScoutImageExtractorReady) {
globalThis.__stayScoutImageExtractorReady = true;

const MAX_LISTING_IMAGES = 30;

function isListingPicturePath(url) {
  return (
    url.includes("/hosting/") ||
    url.includes("/prohost-api/") ||
    /\/miso\/Hosting-/i.test(url)
  );
}

function normalizeHostingImageUrl(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  let url = value.trim().replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  if (!url.includes("muscache.com/im/pictures/")) {
    return null;
  }

  url = url.split("?")[0];

  if (!isListingPicturePath(url)) {
    const direct = url.match(/^https:\/\/a0\.muscache\.com\/im\/pictures\/[a-f0-9-]+\.(jpe?g|png|webp)$/i);
    return direct ? url : null;
  }

  const sized = url.match(
    /^(https:\/\/a0\.muscache\.com\/im\/pictures\/(?:hosting|prohost-api|miso)\/Hosting-\d+)\/([^/]+)\/([^/?#]+)$/i,
  );
  if (sized && sized[2] !== "original") {
    return `${sized[1]}/original/${sized[3]}`;
  }

  if (url.includes("/original/")) {
    return url.startsWith("http") ? url : null;
  }

  return null;
}

function collectUrlsFromJsonValue(value, urls, depth = 0) {
  if (depth > 40 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const normalized = normalizeHostingImageUrl(value);
    if (normalized) {
      urls.add(normalized);
    }

    const inlineMatches = value.matchAll(/https:\/\/a0\.muscache\.com\/im\/pictures\/[^"'\\<>\s]+/g);
    for (const match of inlineMatches) {
      const inline = normalizeHostingImageUrl(match[0]);
      if (inline) {
        urls.add(inline);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUrlsFromJsonValue(item, urls, depth + 1));
    return;
  }

  if (typeof value === "object") {
    for (const key of ["baseUrl", "url", "picture", "xlPicture", "large", "original"]) {
      if (value[key]) {
        collectUrlsFromJsonValue(value[key], urls, depth + 1);
      }
    }

    Object.values(value).forEach((item) => collectUrlsFromJsonValue(item, urls, depth + 1));
  }
}

function collectUrlsFromTextBlob(text, urls) {
  if (!text) {
    return;
  }

  const baseUrlMatches = text.matchAll(
    /"baseUrl":"(https:(?:\\\/\\\/|\/)a0\.muscache\.com(?:\\\/|\/)im(?:\\\/|\/)pictures(?:\\\/|\/)hosting[^"]+)"/g,
  );
  for (const match of baseUrlMatches) {
    const normalized = normalizeHostingImageUrl(match[1]);
    if (normalized) {
      urls.add(normalized);
    }
  }

  const urlMatches = text.matchAll(/https:\/\/a0\.muscache\.com\/im\/pictures\/[^"'\\<>\s]+/g);
  for (const match of urlMatches) {
    const normalized = normalizeHostingImageUrl(match[0]);
    if (normalized) {
      urls.add(normalized);
    }
  }
}

function extractImagesFromJsonScripts(scripts) {
  const urls = new Set();

  for (const script of scripts) {
    const text = typeof script === "string" ? script : script?.textContent?.trim();
    if (!text) {
      continue;
    }

    if (text.includes("niobeClientData") || text.includes("muscache.com/im/pictures/")) {
      try {
        collectUrlsFromJsonValue(JSON.parse(text), urls);
      } catch {
        collectUrlsFromTextBlob(text, urls);
      }
    } else {
      collectUrlsFromTextBlob(text, urls);
    }
  }

  return urls;
}

function extractImagesFromHtml(html, hostingId) {
  const urls = new Set();

  const scriptMatches = html.matchAll(
    /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  const jsonScripts = [];
  for (const match of scriptMatches) {
    jsonScripts.push(match[1]);
  }

  extractImagesFromJsonScripts(jsonScripts).forEach((url) => urls.add(url));
  collectUrlsFromTextBlob(html, urls);

  return finalizeImageUrls(urls, hostingId);
}

function hostingIdFromUrl(url) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).pathname.match(/\/rooms\/(\d+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function imageKeyForUrl(url) {
  return url.match(/\/original\/([^/?#]+)/)?.[1] || url;
}

function finalizeImageUrls(urls, hostingId, options = {}) {
  const maxImages = options.maxImages ?? MAX_LISTING_IMAGES;
  const requireHosting = options.requireHosting ?? true;
  const hostingKey = hostingId ? `Hosting-${hostingId}` : null;
  const imageKey = imageKeyForUrl;
  const seen = new Set();
  const unique = [];

  const pushUnique = (url, mustMatchHosting) => {
    if (mustMatchHosting && hostingKey && !url.includes(hostingKey)) {
      return;
    }

    const id = imageKey(url);
    if (seen.has(id)) {
      return;
    }

    seen.add(id);
    unique.push(url);
  };

  if (requireHosting) {
    for (const url of urls) {
      pushUnique(url, true);
    }

    if (!unique.length) {
      for (const url of urls) {
        pushUnique(url, false);
      }
    }
  } else {
    for (const url of urls) {
      pushUnique(url, false);
    }
  }

  return unique.slice(0, maxImages);
}

const PAGINATION_RE = /^\d+\s*\/\s*\d+$/;
const UNCATEGORIZED_ROOM = Symbol("uncategorized");
// Airbnb labels every photo-tour image's alt/aria-label as "<Room name> image <N>"
// (e.g. "Living room image 3"), including on the sidebar's jump-to-room thumbnails.
// That's a far more reliable room signal than anything in the surrounding markup.
const ROOM_ALT_RE = /^(.+?)\s+image\s+\d+$/i;

function getQualifyingImageUrl(img) {
  const candidates = [img.getAttribute("data-original-uri"), img.currentSrc, img.src];
  for (const candidate of candidates) {
    const normalized = normalizeHostingImageUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const srcset = img.getAttribute("srcset");
  if (srcset) {
    for (const entry of srcset.split(",")) {
      const normalized = normalizeHostingImageUrl(entry.trim().split(/\s+/)[0]);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function collectQualifyingImageElements(modal) {
  const seen = new Set();
  const result = [];

  modal.querySelectorAll("img").forEach((img) => {
    if (seen.has(img)) {
      return;
    }
    const url = getQualifyingImageUrl(img);
    if (url) {
      seen.add(img);
      result.push({ element: img, url });
    }
  });

  return result;
}

function countQualifyingImages(node) {
  let count = 0;
  node.querySelectorAll("img").forEach((img) => {
    if (getQualifyingImageUrl(img)) {
      count += 1;
    }
  });
  return count;
}

// Airbnb's photo tour markup uses generated, unstable class names, so instead of
// selectors we climb from each photo to the smallest ancestor that still contains
// exactly that one photo and has visible text alongside it (the caption/room label).
function findPhotoTile(img, modal) {
  let node = img.parentElement;
  let depth = 0;

  while (node && node !== modal && depth < 10) {
    const count = countQualifyingImages(node);
    if (count > 1) {
      return null;
    }
    if (count === 1 && node.textContent.replace(/\s+/g, "").length > 0) {
      return node;
    }
    node = node.parentElement;
    depth += 1;
  }

  return null;
}

function collectTileTextLines(tile) {
  const doc = tile.ownerDocument || document;
  const walker = doc.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
  const lines = [];
  let node = walker.nextNode();

  while (node) {
    const parentTag = node.parentElement?.tagName;
    if (parentTag !== "SCRIPT" && parentTag !== "STYLE") {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text && !PAGINATION_RE.test(text) && lines[lines.length - 1] !== text) {
        lines.push(text);
      }
    }
    node = walker.nextNode();
  }

  return lines;
}

function getImageRoomLabel(img) {
  const candidates = [img.alt, img.getAttribute("aria-label"), img.closest("button")?.getAttribute("aria-label")];

  for (const raw of candidates) {
    const match = (raw || "").match(ROOM_ALT_RE);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

// Best-effort only: most listings have no host-written photo captions at all, so
// this simply grabs any leftover visible text near the photo that isn't just a
// repeat of the room name already pulled from the image's alt text.
function getPhotoCaption(img, modal, room) {
  const tile = findPhotoTile(img, modal);
  if (!tile) {
    return null;
  }

  const lines = collectTileTextLines(tile).filter(
    (line) => !room || line.toLowerCase() !== room.toLowerCase(),
  );

  return lines.length ? lines.join(" ") : null;
}

// Groups photo-tour images by the room/space Airbnb labels them with (e.g. "Living
// room", "Bedroom 2"), so the app can show photos organized by space instead of one
// flat list. Falls back to an "uncategorized" bucket when no label is detected for a
// photo, and the caller should fall back further to the flat `images` list when
// `rooms` never resolves any real room names at all.
function extractRoomsFromPhotoTourModal(modal, pageUrl) {
  if (!modal) {
    return { images: [], rooms: [] };
  }

  const hostingId = hostingIdFromUrl(pageUrl || globalThis.location?.href);
  const seenKeys = new Set();
  const orderedUrls = [];
  const roomMap = new Map();

  collectQualifyingImageElements(modal).forEach(({ element, url }) => {
    const key = imageKeyForUrl(url);
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    orderedUrls.push(url);

    const room = getImageRoomLabel(element);
    const caption = getPhotoCaption(element, modal, room);
    const bucket = room || UNCATEGORIZED_ROOM;

    if (!roomMap.has(bucket)) {
      roomMap.set(bucket, []);
    }
    roomMap.get(bucket).push({ url, caption });
  });

  const rooms = [];
  const images = [];

  for (const [bucket, photos] of roomMap) {
    const captions = {};
    photos.forEach((photo) => {
      images.push(photo.url);
      if (photo.caption) {
        captions[photo.url] = photo.caption;
      }
    });

    rooms.push({
      room: bucket === UNCATEGORIZED_ROOM ? null : bucket,
      images: photos.map((photo) => photo.url),
      captions,
    });
  }

  return { images, rooms };
}

function extractImagesFromDocument(documentRef, pageUrl) {
  const urls = new Set();
  const hostingId = hostingIdFromUrl(pageUrl || documentRef?.location?.href);

  const jsonScripts = documentRef.querySelectorAll('script[type="application/json"]');
  extractImagesFromJsonScripts(jsonScripts).forEach((url) => urls.add(url));

  const ogImage = documentRef.querySelector('meta[property="og:image"]');
  if (ogImage?.content) {
    const normalized = normalizeHostingImageUrl(ogImage.content);
    if (normalized) {
      urls.add(normalized);
    }
  }

  documentRef.querySelectorAll('img[src*="muscache.com/im/pictures"]').forEach((img) => {
    const normalized = normalizeHostingImageUrl(img.currentSrc || img.src);
    if (normalized) {
      urls.add(normalized);
    }
  });

  documentRef.querySelectorAll('[srcset*="muscache.com/im/pictures"]').forEach((element) => {
    const srcset = element.getAttribute("srcset") || "";
    srcset.split(",").forEach((entry) => {
      const normalized = normalizeHostingImageUrl(entry.trim().split(/\s+/)[0]);
      if (normalized) {
        urls.add(normalized);
      }
    });
  });

  collectUrlsFromTextBlob(documentRef.documentElement?.innerHTML || "", urls);

  return finalizeImageUrls(urls, hostingId);
}

globalThis.stayScoutImageExtractor = {
  MAX_LISTING_IMAGES,
  normalizeHostingImageUrl,
  extractImagesFromHtml,
  extractImagesFromDocument,
  extractRoomsFromPhotoTourModal,
  hostingIdFromUrl,
  finalizeImageUrls,
};

}

const MAX_LISTING_IMAGES = 30;
const MAX_PHOTO_TOUR_IMAGES = 50;

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

function finalizeImageUrls(urls, hostingId, options = {}) {
  const maxImages = options.maxImages ?? MAX_LISTING_IMAGES;
  const requireHosting = options.requireHosting ?? true;
  const hostingKey = hostingId ? `Hosting-${hostingId}` : null;
  const imageKey = (url) => url.match(/\/original\/([^/?#]+)/)?.[1] || url;
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

function collectUrlsFromSrcset(srcset, urls) {
  if (!srcset) {
    return;
  }

  srcset.split(",").forEach((entry) => {
    const normalized = normalizeHostingImageUrl(entry.trim().split(/\s+/)[0]);
    if (normalized) {
      urls.add(normalized);
    }
  });
}

function extractImagesFromPhotoTourModal(modal, pageUrl) {
  if (!modal) {
    return [];
  }

  const urls = new Set();
  const hostingId = hostingIdFromUrl(pageUrl || globalThis.location?.href);

  modal.querySelectorAll("img[data-original-uri]").forEach((img) => {
    const normalized = normalizeHostingImageUrl(img.getAttribute("data-original-uri"));
    if (normalized) {
      urls.add(normalized);
    }
  });

  modal.querySelectorAll('img[src*="muscache.com/im/pictures"]').forEach((img) => {
    const normalized = normalizeHostingImageUrl(
      img.getAttribute("data-original-uri") || img.currentSrc || img.src,
    );
    if (normalized) {
      urls.add(normalized);
    }
  });

  modal.querySelectorAll('source[srcset*="muscache.com"], img[srcset*="muscache.com"]').forEach((element) => {
    collectUrlsFromSrcset(element.getAttribute("srcset"), urls);
  });

  collectUrlsFromTextBlob(modal.innerHTML || "", urls);

  return finalizeImageUrls(urls, hostingId, {
    maxImages: MAX_PHOTO_TOUR_IMAGES,
    requireHosting: false,
  });
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
  MAX_PHOTO_TOUR_IMAGES,
  normalizeHostingImageUrl,
  extractImagesFromHtml,
  extractImagesFromDocument,
  extractImagesFromPhotoTourModal,
  hostingIdFromUrl,
  finalizeImageUrls,
};

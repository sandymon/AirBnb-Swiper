const fs = require("fs");

function normalizeHostingImageUrl(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  let url = value.trim().replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  if (!url.includes("muscache.com/im/pictures/hosting/")) {
    return null;
  }

  url = url.split("?")[0];

  const sized = url.match(
    /^(https:\/\/a0\.muscache\.com\/im\/pictures\/hosting\/Hosting-\d+)\/([^/]+)\/([^/?#]+)$/i,
  );
  if (sized && sized[2] !== "original") {
    return `${sized[1]}/original/${sized[3]}`;
  }

  if (url.includes("/original/")) {
    return url.startsWith("http") ? url : null;
  }

  return null;
}

function scrapeListingImagesFromHtml(html, hostingId = "1720686946312544875") {
  const urls = new Set();
  const addUrl = (value) => {
    const normalized = normalizeHostingImageUrl(value);
    if (normalized) {
      urls.add(normalized);
    }
  };

  const og = html.match(/property="og:image"\s+content="([^"]+)"/);
  if (og) {
    addUrl(og[1]);
  }

  const baseUrlMatches = html.matchAll(
    /"baseUrl":"(https:(?:\\\/\\\/|\/)a0\.muscache\.com(?:\\\/|\/)im(?:\\\/|\/)pictures(?:\\\/|\/)hosting[^"]+)"/g,
  );
  for (const match of baseUrlMatches) {
    addUrl(match[1]);
  }

  const urlMatches = html.matchAll(/https:\/\/a0\.muscache\.com\/im\/pictures\/hosting\/[^"'\\<>\s]+/g);
  for (const match of urlMatches) {
    addUrl(match[0]);
  }

  const hostingKey = hostingId ? `Hosting-${hostingId}` : null;
  const key = (url) => url.match(/\/original\/([^/?#]+)/)?.[1] || url;
  const seen = new Set();
  const unique = [];

  for (const url of urls) {
    if (hostingKey && !url.includes(hostingKey)) {
      continue;
    }
    const id = key(url);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(url);
  }

  if (!unique.length) {
    const fallbackSeen = new Set();
    for (const url of urls) {
      const id = key(url);
      if (fallbackSeen.has(id)) {
        continue;
      }
      fallbackSeen.add(id);
      unique.push(url);
    }
  }

  return unique.slice(0, 10);
}

const html = fs.readFileSync("examplearibnblsiitng.txt", "utf8");
const full = scrapeListingImagesFromHtml(html);
console.log("full html", full.length, full[0]?.slice(-40));

const ogOnly = `<html><head><meta property="og:image" content="https://a0.muscache.com/im/pictures/hosting/Hosting-1720686946312544875/original/d1aa154f-cc03-491f-9457-df64c73f7fc5.jpeg"></head><body></body></html>`;
console.log("og only before baseUrl in script", scrapeListingImagesFromHtml(ogOnly).length);

const withScript = ogOnly.replace(
  "</body>",
  '<script>window.x={"baseUrl":"https://a0.muscache.com/im/pictures/hosting/Hosting-1720686946312544875/original/abc.jpeg"}</script></body>',
);
console.log("og + one baseUrl", scrapeListingImagesFromHtml(withScript).length);

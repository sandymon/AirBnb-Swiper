const AMENITY_RULES = [
  { label: "Pool", patterns: [/pool/i] },
  { label: "Hot tub", patterns: [/hot tub/i] },
  { label: "Workspace", patterns: [/workspace/i] },
  { label: "Parking", patterns: [/parking/i] },
];

function parseHtmlSnippet(text) {
  if (!/<[a-z][\s\S]*>/i.test(text)) {
    return { text, title: undefined };
  }

  const documentFragment = new DOMParser().parseFromString(text, "text/html");
  documentFragment.querySelectorAll("script, style, svg").forEach((element) => element.remove());
  const heading = documentFragment.querySelector("h1, h2, [role='heading']");
  return {
    text: documentFragment.body.innerText || documentFragment.body.textContent || text,
    title: heading?.textContent?.replace(/\s+/g, " ").trim(),
  };
}

function parseListingText(text) {
  const parsedHtml = parseHtmlSnippet(text);
  const normalized = parsedHtml.text.replace(/\s+/g, " ").trim();

  const guestMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:guest|guests)\b/i);
  const bedroomsOnlyMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:bedroom|bedrooms)\b/i);
  const bedsMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:beds|bed)\b/i);
  const bathsMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:baths|bathrooms|bathroom|bath)\b/i);
  const ratingMatch =
    normalized.match(/(?:rated|rating|star rating)\s*(\d(?:\.\d)?)/i) ||
    normalized.match(/\b(\d(?:\.\d)?)\s*(?:stars?|★)/i);

  const title = parsedHtml.title;
  const areaMatch = title?.match(/\bin\s+(.+)$/i);

  return {
    title,
    area: areaMatch ? areaMatch[1] : undefined,
    price: scrapePriceFromText(normalized),
    guests: guestMatch ? Math.ceil(Number(guestMatch[1])) : undefined,
    bedrooms: bedroomsOnlyMatch ? Math.ceil(Number(bedroomsOnlyMatch[1])) : undefined,
    beds: bedsMatch ? Math.ceil(Number(bedsMatch[1])) : undefined,
    baths: bathsMatch ? Number(bathsMatch[1]) : undefined,
    rating: ratingMatch ? Number(ratingMatch[1]) : undefined,
    amenities: scrapeAmenitiesFromText(normalized),
  };
}

function parseMoney(value) {
  if (value == null) {
    return undefined;
  }

  const number = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) ? number : undefined;
}

function priceFromStayTotal(text) {
  if (!text) {
    return null;
  }

  const match = text.match(/\$([\d,]+(?:\.\d{1,2})?)\s+for\s+(\d+)\s+nights?\b/i);
  if (!match) {
    return null;
  }

  const total = parseMoney(match[1]);
  const nights = Number(match[2]);
  if (!total || !nights || nights < 1) {
    return null;
  }

  return {
    price: Math.round(total / nights),
    nights,
    total: Math.round(total),
  };
}

function priceFromNightly(text) {
  if (!text) {
    return null;
  }

  const match = text.match(/\$([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*night|per night)\b/i);
  if (!match) {
    return null;
  }

  const price = parseMoney(match[1]);
  if (!price) {
    return null;
  }

  return { price: Math.round(price) };
}

function scrapePriceFromText(text) {
  const stayTotal = priceFromStayTotal(text);
  if (stayTotal) {
    return stayTotal.price;
  }

  const nightly = priceFromNightly(text);
  if (nightly) {
    return nightly.price;
  }

  const standaloneMatches = [...text.matchAll(/\$([\d,]+)(?!\s+for\s+\d+\s+night)/gi)];
  for (const match of standaloneMatches) {
    const value = parseMoney(match[1]);
    if (value >= 50 && value <= 5000) {
      return Math.round(value);
    }
  }

  return undefined;
}

function scrapeListingPrice() {
  const sources = [];

  const bookingSection =
    document.querySelector('[data-section-id="BOOK_IT_SIDEBAR"]') ||
    document.querySelector('[data-section-id="BOOK_IT_DEFAULT"]') ||
    document.querySelector('[data-section-id="BOOK_IT"]');

  if (bookingSection?.innerText) {
    sources.push(bookingSection.innerText);
  }

  document.querySelectorAll(".a8jt5op").forEach((element) => {
    const text = element.textContent?.trim();
    if (text) {
      sources.push(text);
    }
  });

  document.querySelectorAll('[class*="pricing-guest"]').forEach((element) => {
    const text = element.textContent?.trim();
    if (text) {
      sources.push(text);
    }
  });

  sources.push(document.body.innerText);

  for (const text of sources) {
    const stayTotal = priceFromStayTotal(text);
    if (stayTotal) {
      return stayTotal;
    }
  }

  for (const text of sources) {
    const nightly = priceFromNightly(text);
    if (nightly) {
      return nightly;
    }
  }

  return null;
}

function scrapeAmenitiesFromText(text) {
  return AMENITY_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(text)),
  ).map((rule) => rule.label);
}

function scrapeJsonLd() {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent);
      const items = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];

      for (const item of items) {
        if (!item || typeof item !== "object") {
          continue;
        }

        if (item["@type"] !== "VacationRental" && item["@type"] !== "Accommodation") {
          continue;
        }

        let fullAddress = "";
        if (typeof item.address === "string") {
          fullAddress = item.address;
        } else if (item.address) {
          fullAddress = [
            item.address.streetAddress,
            item.address.addressLocality,
            item.address.addressRegion,
            item.address.postalCode,
            item.address.addressCountry,
          ]
            .filter(Boolean)
            .join(", ");
        }

        return {
          name: item.name,
          address: fullAddress,
          locality: item.address?.addressLocality,
          region: item.address?.addressRegion,
        };
      }
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  }

  return null;
}

function scrapeListingLocation(fallbackArea) {
  const locationSection = document.querySelector('[data-section-id="LOCATION_DEFAULT"]');
  if (locationSection) {
    const lines = locationSection.innerText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const locationLine = lines.find(
      (line) =>
        line.includes(",") &&
        !/where you/i.test(line) &&
        !/exact location/i.test(line) &&
        !/meet your host/i.test(line),
    );

    if (locationLine) {
      return locationLine.replace(/, United States$/i, "").trim();
    }
  }

  const jsonLd = scrapeJsonLd();
  if (jsonLd?.address) {
    return jsonLd.address.replace(/, United States$/i, "").trim();
  }

  if (jsonLd?.locality && jsonLd?.region) {
    return `${jsonLd.locality}, ${jsonLd.region}`;
  }

  return fallbackArea || "";
}

function normalizeHostingImageUrl(value) {
  return globalThis.stayScoutImageExtractor?.normalizeHostingImageUrl(value) ?? null;
}

function collectImageSources() {
  const sources = [];

  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage?.content) {
    sources.push(ogImage.content);
  }

  document.querySelectorAll('img[src*="muscache.com/im/pictures/hosting"]').forEach((img) => {
    sources.push(img.currentSrc || img.src);
  });

  document.querySelectorAll('[srcset*="muscache.com/im/pictures/hosting"]').forEach((element) => {
    const srcset = element.getAttribute("srcset") || "";
    srcset.split(",").forEach((entry) => {
      sources.push(entry.trim().split(/\s+/)[0]);
    });
  });

  sources.push(document.documentElement.innerHTML);

  document.querySelectorAll("script:not([src])").forEach((script) => {
    const text = script.textContent;
    if (text?.includes("muscache.com/im/pictures/hosting/")) {
      sources.push(text);
    }
  });

  return sources;
}

function scrapeListingImages() {
  if (globalThis.stayScoutImageExtractor?.extractImagesFromDocument) {
    return globalThis.stayScoutImageExtractor.extractImagesFromDocument(document, window.location.href);
  }

  const urls = new Set();
  const addUrl = (value) => {
    const normalized = normalizeHostingImageUrl(value);
    if (normalized) {
      urls.add(normalized);
    }
  };

  for (const source of collectImageSources()) {
    if (!source) {
      continue;
    }

    if (source.startsWith("http")) {
      addUrl(source);
      continue;
    }

    const baseUrlMatches = source.matchAll(
      /"baseUrl":"(https:(?:\\\/\\\/|\/)a0\.muscache\.com(?:\\\/|\/)im(?:\\\/|\/)pictures(?:\\\/|\/)hosting[^"]+)"/g,
    );
    for (const match of baseUrlMatches) {
      addUrl(match[1]);
    }

    const urlMatches = source.matchAll(/https:\/\/a0\.muscache\.com\/im\/pictures\/hosting\/[^"'\\<>\s]+/g);
    for (const match of urlMatches) {
      addUrl(match[0]);
    }
  }

  const hostingId = window.location.pathname.match(/\/rooms\/(\d+)/)?.[1];
  const hostingKey = hostingId ? `Hosting-${hostingId}` : null;
  const imageKey = (url) => url.match(/\/original\/([^/?#]+)/)?.[1] || url;
  const seen = new Set();
  const unique = [];

  const pushUnique = (url, requireHosting) => {
    if (requireHosting && hostingKey && !url.includes(hostingKey)) {
      return;
    }

    const id = imageKey(url);
    if (seen.has(id)) {
      return;
    }

    seen.add(id);
    unique.push(url);
  };

  for (const url of urls) {
    pushUnique(url, true);
  }

  if (!unique.length) {
    for (const url of urls) {
      pushUnique(url, false);
    }
  }

  return unique.slice(0, 10);
}

function scrapeAirbnbPage() {
  const jsonLd = scrapeJsonLd();
  const overview =
    document.querySelector('[data-section-id="OVERVIEW_DEFAULT_V2"]') ||
    document.querySelector('[data-plugin-in-point-id="OVERVIEW_DEFAULT_V2"]');

  const headingEl =
    overview?.querySelector('h2[role="heading"]') ||
    overview?.querySelector("h1, h2") ||
    document.querySelector('h1[data-testid="listing-title"]') ||
    document.querySelector("h1");

  const headingTitle = headingEl?.textContent?.replace(/\s+/g, " ").trim();
  const overviewHtml = overview?.outerHTML || "";
  const parsed = parseListingText(overviewHtml || document.body.innerHTML);

  const title = jsonLd?.name || headingTitle || parsed.title || "Imported stay";
  const areaFromHeading = headingTitle?.match(/\bin\s+(.+)$/i)?.[1];
  const area = areaFromHeading || parsed.area || jsonLd?.locality || "";
  const location = scrapeListingLocation(area);

  const listingPrice = scrapeListingPrice();
  if (listingPrice) {
    parsed.price = listingPrice.price;
    parsed.priceNights = listingPrice.nights;
    parsed.priceTotal = listingPrice.total;
  } else if (!parsed.price) {
    parsed.price = scrapePriceFromText(document.body.innerText);
  }

  const overviewText = overview?.innerText || "";
  if (/new listing/i.test(overviewText)) {
    parsed.rating = undefined;
  } else if (!parsed.rating) {
    const ratingMatch = document.body.innerText.match(/(\d\.\d+)\s*(?:·|\(|out of|stars?)/i);
    if (ratingMatch) {
      parsed.rating = Number(ratingMatch[1]);
    }
  }

  const amenitiesSection = document.querySelector('[data-section-id="AMENITIES_DEFAULT"]');
  if (amenitiesSection) {
    const found = scrapeAmenitiesFromText(amenitiesSection.innerText);
    parsed.amenities = [...new Set([...(parsed.amenities || []), ...found])];
  }

  return {
    title,
    url: window.location.href.split("?")[0],
    area: location || area,
    location: location || area,
    price: parsed.price,
    priceNights: parsed.priceNights,
    priceTotal: parsed.priceTotal,
    guests: parsed.guests,
    bedrooms: parsed.bedrooms,
    beds: parsed.beds,
    baths: parsed.baths,
    rating: parsed.rating,
    amenities: parsed.amenities || [],
    images: scrapeListingImages(),
  };
}

// Nominatim asks for at most 1 request/second. We only pay that delay when a
// real network geocode happens (cache misses), not on cached hits.
const NOMINATIM_DELAY_MS = 1100;
const geocodeCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatOrigin(anchor) {
  if (anchor.lat != null && anchor.lng != null) {
    return `${anchor.lat},${anchor.lng}`;
  }

  return (anchor.address || anchor.location || anchor.label || "").trim();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  return response.json();
}

function minutesFromSeconds(seconds) {
  return Math.max(1, Math.round(Number(seconds) / 60));
}

// Resolve an origin/destination that is already a coordinate pair (object or
// "lat,lng" string) without touching the network. Returns null when a geocode
// is required.
function parseCoordinates(value) {
  if (value && typeof value === "object" && value.lat != null && value.lng != null) {
    return { lat: Number(value.lat), lon: Number(value.lng) };
  }

  if (typeof value === "string" && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(value)) {
    const [lat, lon] = value.split(",").map(Number);
    return { lat, lon };
  }

  return null;
}

async function geocodeWithNominatim(query) {
  const key = query.trim().toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached) {
    return cached;
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const results = await fetchJson(url, {
    headers: { "User-Agent": "StayScout/1.0 (local trip planner)" },
  });

  if (!results.length) {
    throw new Error(`Could not find "${query}"`);
  }

  const geocoded = {
    lat: Number(results[0].lat),
    lon: Number(results[0].lon),
    label: results[0].display_name,
  };
  geocodeCache.set(key, geocoded);
  return geocoded;
}

// Resolve coordinates, reporting whether a network geocode was needed so the
// caller can pace requests only when Nominatim was actually hit.
async function resolveCoordinates(value) {
  const direct = parseCoordinates(value);
  if (direct) {
    return { coords: direct, geocoded: false };
  }

  const cacheKey = String(value).trim().toLowerCase();
  const wasCached = geocodeCache.has(cacheKey);
  const coords = await geocodeWithNominatim(String(value));
  return { coords, geocoded: !wasCached };
}

async function osrmRouteMinutes(from, to, destinationLabel) {
  const routeUrl = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const route = await fetchJson(routeUrl);

  if (route.code !== "Ok" || !route.routes?.length) {
    throw new Error(`No driving route to "${destinationLabel}"`);
  }

  return minutesFromSeconds(route.routes[0].duration);
}

async function osrmTravelMinutesBatch(anchors, destination) {
  const times = {};
  const errors = {};

  // Geocode the shared destination a single time instead of once per anchor.
  let destinationCoords;
  try {
    ({ coords: destinationCoords } = await resolveCoordinates(destination));
  } catch (error) {
    for (const anchor of anchors) {
      errors[anchor.id] = error.message;
    }
    return { times, errors };
  }

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    let didGeocode = false;

    try {
      const origin =
        anchor.lat != null && anchor.lng != null
          ? { lat: anchor.lat, lng: anchor.lng }
          : anchor.location;
      const { coords, geocoded } = await resolveCoordinates(origin);
      didGeocode = geocoded;
      times[anchor.id] = await osrmRouteMinutes(coords, destinationCoords, destination);
    } catch (error) {
      errors[anchor.id] = error.message;
    }

    // Only respect the Nominatim rate limit when we actually geocoded, and
    // never after the final anchor.
    if (didGeocode && index < anchors.length - 1) {
      await sleep(NOMINATIM_DELAY_MS);
    }
  }

  return { times, errors };
}

async function googleTravelMinutesBatch(anchors, destination, apiKey, mode = "driving") {
  const originStrings = anchors.map((anchor) => anchor.location);
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", originStrings.join("|"));
  url.searchParams.set("destinations", destination);
  url.searchParams.set("mode", mode);
  url.searchParams.set("units", "imperial");
  url.searchParams.set("key", apiKey);

  const data = await fetchJson(url);

  if (data.status !== "OK") {
    throw new Error(data.error_message || `Google Maps error: ${data.status}`);
  }

  const times = {};
  const errors = {};

  data.rows.forEach((row, index) => {
    const anchor = anchors[index];
    const element = row.elements?.[0];

    if (!anchor) {
      return;
    }

    if (element?.status === "OK") {
      times[anchor.id] = minutesFromSeconds(element.duration.value);
    } else {
      errors[anchor.id] = element?.status || "UNKNOWN";
    }
  });

  return { times, errors };
}

async function calculateTravelTimes({ anchors, destination, mode = "driving", googleApiKey }) {
  const usableAnchors = anchors
    .map((anchor) => ({
      id: anchor.id,
      location: formatOrigin(anchor),
      lat: anchor.lat,
      lng: anchor.lng,
    }))
    .filter((anchor) => anchor.location);

  if (!destination?.trim()) {
    throw new Error("Listing location is required.");
  }

  if (!usableAnchors.length) {
    throw new Error("Add at least one starting location first.");
  }

  // Distance Matrix is called directly from this server, not a browser, so it
  // has no Referer header — a referrer-restricted key (the right choice for
  // the client-side Maps/Places key below) gets rejected with "API keys with
  // referer restrictions cannot be used with this API." Use a separate,
  // IP-or-unrestricted key for this call when one is configured.
  const serverApiKey = process.env.GOOGLE_MAPS_SERVER_KEY || process.env.GOOGLE_MAPS_API_KEY;
  const apiKey = serverApiKey || googleApiKey;

  if (!apiKey && mode !== "driving") {
    throw new Error("Transit and walking require a Google Maps API key.");
  }

  if (apiKey) {
    const result = await googleTravelMinutesBatch(usableAnchors, destination.trim(), apiKey, mode);
    return {
      provider: "google",
      destination: destination.trim(),
      times: result.times,
      errors: result.errors,
    };
  }

  const result = await osrmTravelMinutesBatch(usableAnchors, destination.trim());
  return {
    provider: "osrm",
    destination: destination.trim(),
    times: result.times,
    errors: result.errors,
  };
}

module.exports = {
  calculateTravelTimes,
};

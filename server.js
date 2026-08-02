const http = require("http");
const fs = require("fs");
const path = require("path");

try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env file present — fall back to any existing environment variables.
}

const { calculateTravelTimes } = require("./travel-time");
const { cacheListingImages } = require("./image-cache");
const db = require("./db");

const port = Number(process.env.PORT) || 5173;
const root = __dirname;
const allowRemoveListings = String(process.env.ALLOW_REMOVE_LISTINGS ?? "true").toLowerCase() !== "false";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function serveStatic(request, response) {
  const requestedPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(data);
  });
}

async function handleTravelTimesRequest(request, response) {
  try {
    const rawBody = await readRequestBody(request);
    const body = rawBody ? JSON.parse(rawBody) : {};
    const result = await calculateTravelTimes({
      anchors: body.anchors || [],
      destination: body.destination || "",
      mode: body.mode || "driving",
      googleApiKey: body.googleApiKey || "",
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

async function handleCacheImagesRequest(request, response) {
  try {
    const rawBody = await readRequestBody(request);
    const body = rawBody ? JSON.parse(rawBody) : {};
    const result = await cacheListingImages(root, body.listingId, body.urls || []);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

function handleGetConfig(response) {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || "";
  sendJson(response, 200, {
    googleMapsApiKey,
    hasGoogleMapsKey: Boolean(googleMapsApiKey),
    allowRemoveListings,
  });
}

function handleGetState(response) {
  try {
    sendJson(response, 200, db.getState());
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

async function handleSaveListings(request, response) {
  try {
    const rawBody = await readRequestBody(request);
    const body = rawBody ? JSON.parse(rawBody) : {};
    const incoming = body.listings || [];
    const count = db.replaceListings(incoming, { preserveExisting: !allowRemoveListings });

    if (count !== incoming.length) {
      console.log(
        `[stayscout] Save request sent ${incoming.length} listing(s); kept ${count} ` +
          `(blocked removal of ${count - incoming.length}, ALLOW_REMOVE_LISTINGS=false).`,
      );
    }

    sendJson(response, 200, { ok: true, count });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

async function handleSaveSettings(request, response) {
  try {
    const rawBody = await readRequestBody(request);
    const body = rawBody ? JSON.parse(rawBody) : {};
    db.saveSettings(body);
    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

async function handleVote(request, response) {
  try {
    const rawBody = await readRequestBody(request);
    const body = rawBody ? JSON.parse(rawBody) : {};
    const voterId = body.voterId || "";
    const voterName = body.voterName || "";
    const listingId = body.listingId || "";
    const vote = body.vote !== false;

    console.log(
      `[stayscout] ${voterName || voterId || "unknown"} ${vote ? "voted for" : "removed vote from"} listing ${listingId}`,
    );

    const votes = vote ? db.castVote(voterId, voterName, listingId) : db.removeVote(voterId, listingId);

    sendJson(response, 200, { ok: true, votes });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

const server = http.createServer(async (request, response) => {
  const { pathname: rawPath } = new URL(request.url, `http://${request.headers.host}`);
  const pathname = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;

  if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }

  if (request.method === "POST" && pathname === "/api/travel-times") {
    await handleTravelTimesRequest(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/cache-images") {
    await handleCacheImagesRequest(request, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/config") {
    handleGetConfig(response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/state") {
    handleGetState(response);
    return;
  }

  if (request.method === "PUT" && pathname === "/api/listings") {
    await handleSaveListings(request, response);
    return;
  }

  if (request.method === "PUT" && pathname === "/api/settings") {
    await handleSaveSettings(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/votes") {
    await handleVote(request, response);
    return;
  }

  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Method not allowed" }));
});

server.listen(port, () => {
  console.log(`StayScout is running at http://localhost:${port}`);
  if (process.env.GOOGLE_MAPS_API_KEY) {
    console.log("Google Maps travel times enabled via GOOGLE_MAPS_API_KEY.");
  } else {
    console.log("Using free OSRM routing. Set GOOGLE_MAPS_API_KEY for Google Maps.");
  }
  if (!allowRemoveListings) {
    console.log("ALLOW_REMOVE_LISTINGS=false — listing removal is disabled; voting still works.");
  }
});

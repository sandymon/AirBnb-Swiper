# StayScout — Project Analysis

**Location:** `C:\Users\rodri\OneDrive\Documents\Airbnb`
**Analyzed:** 2026-08-01

## What it is

StayScout is a self-hosted, small-group **Airbnb trip-planning and voting tool**. A group looking at vacation rentals scrapes listings off Airbnb using a companion Chrome extension, and the listings land in a local swipe-to-vote app (Tinder-style) so the group can compare options, vote, and check travel time from one or more "home base" addresses.

No external services are required to run it — everything is a dependency-free vanilla Node.js app with a SQLite database. A Google Maps API key is optional and only upgrades travel-time accuracy and adds address autocomplete.

## Architecture

```
Chrome Extension (scrapes Airbnb) --> localhost:5173 StayScout app --> SQLite (stayscout.db)
```

- **Backend** — [server.js](server.js): a plain Node `http` server (no Express), port `5173` by default. Handles static file serving, CORS for `/api/*`, and routes for travel times, image caching, app state, listings, settings, and votes.
- **Database** — [db.js](db.js): SQLite via Node's built-in `node:sqlite`. Tables: `listings` (JSON blob per listing), `settings` (key/value store), `votes` (one vote per voter per listing).
- **Frontend** — [index.html](index.html) + [app.js](app.js) (~2100 lines) + [styles.css](styles.css): a single-page vanilla-JS app, no framework/build step. Handles the swipe deck, grid view, listing detail modal/lightbox, voting, home-base anchors (via Google Places Autocomplete when a key is set), and the import pipeline that receives scraped listings from the extension.
- **Browser extension** — [extension/](extension/): Manifest V3 "StayScout Scraper" (v1.8). Content script scrapes an open Airbnb listing page (title, price, beds/baths, rating, amenities, location, photos via DOM + JSON-LD); background service worker finds/opens the local StayScout tab and injects the scraped data via `window.stayScoutImportListing(...)`.
- **Support modules**:
  - [image-cache.js](image-cache.js) — downloads Airbnb listing photos to `images/<listingId>/`, restricted to `a0.muscache.com` URLs (SSRF-safe allowlist), max 50 images, 6 concurrent workers.
  - [travel-time.js](travel-time.js) — computes travel time from anchors to listings. Free by default (OSRM + rate-limited Nominatim geocoding, driving only); upgrades to Google Distance Matrix (driving/transit/walking) if `GOOGLE_MAPS_API_KEY` is set.
- **scripts/** — standalone dev/debug scripts that test scraping/parsing logic offline against `examplearibnblsiitng.txt`, a saved real Airbnb listing page used as fixture data.

## Key features

- Tinder-style swipe voting with per-device voter IDs and named votes; leaderboard sorted by votes
- Grid view of all saved listings, sortable by votes/time/price/rating
- Multiple configurable "home base" anchors with drive/transit/walk time badges per listing
- One-click import: browse Airbnb → click extension → scrape → auto-injects into the running app
- Local photo caching from Airbnb's CDN
- Legacy migration path from an earlier localStorage-only version of the app

## Tech stack

- Plain Node.js (`http`, `node:sqlite`) — **no npm dependencies**, no `package.json`, no build step
- Vanilla JS/HTML/CSS frontend
- Chrome Manifest V3 extension
- SQLite (`stayscout.db`, WAL mode)
- Optional: Google Maps JavaScript API, Places API, Distance Matrix API (via `GOOGLE_MAPS_API_KEY` in `.env`)

## Notable / things to know

- **No commits yet** — the directory is a git repo (`master` branch) but every file is untracked, no remote configured. Looks like it was scaffolded by an AI coding tool (a stray Codex CLI checkpoint ref exists) and never committed. File mtimes cluster around July 6–19, 2026, suggesting a short, recent build burst.
- `.agents/` directory exists but is currently empty.
- Only one environment variable is used: `GOOGLE_MAPS_API_KEY` (see `.env.example`); `PORT` is optional and defaults to `5173`.
- `image-cache.js` restricts downloads to Airbnb's own image CDN host patterns, which is a good SSRF mitigation worth preserving if this code changes.

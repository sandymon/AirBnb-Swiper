# StayScout

A self-hosted trip-planning tool for groups deciding on an Airbnb together. Scrape listings straight from Airbnb with a companion Chrome extension, then swipe, vote, and compare them — with travel time from your group's home-base addresses.

## Features

- **Swipe voting** — Tinder-style card stack; each person gets one vote per listing, with a leaderboard of the group's favorites
- **Grid view** — all saved listings, sortable by votes, travel time, price, or rating
- **Travel time** — drive/transit/walk time from one or more configurable home-base "anchors" to every listing
- **One-click import** — a Chrome extension scrapes an open Airbnb listing page and sends it straight into the app
- **Local photo caching** — listing photos are downloaded and served locally
- **No external dependencies** — plain Node.js + SQLite, no `npm install`, no build step

## Requirements

- [Node.js](https://nodejs.org/) 22.5+ (uses the built-in `node:sqlite` module)
- Google Chrome (for the scraper extension)
- Optional: a [Google Maps API key](https://console.cloud.google.com/) (Maps JavaScript API, Places API, Distance Matrix API) for address autocomplete and transit/walking times — otherwise travel time falls back to free driving-only estimates via OSRM/Nominatim

## Getting started

1. **Configure environment variables** (optional)

   ```bash
   cp .env.example .env
   ```

   Set `GOOGLE_MAPS_API_KEY` in `.env` if you have one. `PORT` defaults to `5173`.

2. **Run the server**

   ```bash
   node server.js
   ```

   Open [http://localhost:5173](http://localhost:5173).

3. **Install the Chrome extension**

   - Go to `chrome://extensions`, enable **Developer mode**
   - Click **Load unpacked** and select the [extension/](extension/) folder
   - Browse to any Airbnb listing page, click the StayScout Scraper icon, and hit **Extract & Send** to import it into your running app (the extension looks for a StayScout tab on `localhost:5173`)

4. **Add home-base anchors**

   Open the settings gear in the app, add one or more starting addresses, and enter your name so your votes are attributed to you.

## Project structure

| Path | Purpose |
| --- | --- |
| `server.js` | HTTP server: static files, API routes |
| `db.js` | SQLite persistence (listings, settings, votes) |
| `travel-time.js` | Travel time calculation (OSRM/Nominatim or Google Distance Matrix) |
| `image-cache.js` | Downloads and caches listing photos locally |
| `app.js` / `index.html` / `styles.css` | Frontend (swipe deck, grid view, modals) |
| `extension/` | Chrome Manifest V3 scraper extension |
| `scripts/` | Offline dev scripts for testing the scraping/parsing logic |

See [ANALYSIS.md](ANALYSIS.md) for a more detailed architecture writeup.

## Data storage

Everything is stored locally in `stayscout.db` (SQLite, WAL mode) and `images/`. Nothing is sent to a third party except optional calls to Google Maps APIs (if configured) or the free OSRM/Nominatim routing services.

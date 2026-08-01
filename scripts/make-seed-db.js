const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const sourcePath = process.argv[2] || path.join(__dirname, "..", "stayscout.db");
const destPath = process.argv[3] || path.join(__dirname, "..", "stayscout.seed.db");

if (fs.existsSync(destPath)) {
  fs.unlinkSync(destPath);
}
for (const suffix of ["-wal", "-shm"]) {
  const sidecar = destPath + suffix;
  if (fs.existsSync(sidecar)) {
    fs.unlinkSync(sidecar);
  }
}

const source = new DatabaseSync(sourcePath, { readOnly: true });
const listings = source.prepare("SELECT id, data, position FROM listings ORDER BY position ASC").all();
source.close();

const dest = new DatabaseSync(destPath);
dest.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS votes (
    voter_id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    voter_name TEXT NOT NULL,
    voted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// The source machine's images/ directory (locally cached photo files) doesn't
// travel with this seed, so any localImages/localImageMap pointing at it would
// just 404 on a fresh server. Strip those and fall back to the original
// remote Airbnb CDN URLs, which work standalone.
const insertListing = dest.prepare("INSERT INTO listings (id, data, position) VALUES (?, ?, ?)");
for (const row of listings) {
  const listing = JSON.parse(row.data);
  delete listing.localImages;
  delete listing.localImageMap;
  listing.image = listing.images?.[0] || listing.image || "";
  insertListing.run(row.id, JSON.stringify(listing), row.position);
}
dest.close();

console.log(
  `Wrote ${listings.length} listing(s) to ${destPath} — no votes, no voter names, no home-base address.`,
);

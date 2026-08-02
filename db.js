const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const dbPath = process.env.STAYSCOUT_DB || path.join(__dirname, "stayscout.db");
const db = new DatabaseSync(dbPath);

db.exec(`
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
    voter_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    voter_name TEXT NOT NULL,
    voted_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (voter_id, listing_id)
  );
`);

// Older deployments created `votes` with voter_id alone as the primary key,
// which allowed only one vote per person total. Migrate those in place to
// the (voter_id, listing_id) composite key so a person can vote for several
// listings, still capped at one vote per person per listing.
(function migrateSingleVotePerVoterSchema() {
  const columns = db.prepare("PRAGMA table_info(votes)").all();
  const listingIdIsPrimaryKey = columns.some((column) => column.name === "listing_id" && column.pk > 0);
  if (listingIdIsPrimaryKey) {
    return;
  }

  db.exec(`
    ALTER TABLE votes RENAME TO votes_legacy_single_vote;

    CREATE TABLE votes (
      voter_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      voter_name TEXT NOT NULL,
      voted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (voter_id, listing_id)
    );

    INSERT INTO votes (voter_id, listing_id, voter_name, voted_at)
      SELECT voter_id, listing_id, voter_name, voted_at FROM votes_legacy_single_vote;

    DROP TABLE votes_legacy_single_vote;
  `);
})();

const statements = {
  selectListings: db.prepare("SELECT id, data FROM listings ORDER BY position ASC"),
  deleteAllListings: db.prepare("DELETE FROM listings"),
  insertListing: db.prepare("INSERT INTO listings (id, data, position) VALUES (?, ?, ?)"),
  selectSetting: db.prepare("SELECT value FROM settings WHERE key = ?"),
  upsertSetting: db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ),
  selectVotes: db.prepare(
    "SELECT voter_id, listing_id, voter_name, voted_at FROM votes ORDER BY voted_at ASC",
  ),
  upsertVote: db.prepare(
    `INSERT INTO votes (voter_id, listing_id, voter_name, voted_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(voter_id, listing_id) DO UPDATE SET
       voter_name = excluded.voter_name,
       voted_at = datetime('now')`,
  ),
  deleteVote: db.prepare("DELETE FROM votes WHERE voter_id = ? AND listing_id = ?"),
  deleteVotesForListing: db.prepare("DELETE FROM votes WHERE listing_id = ?"),
  deleteVotesNotInListings: db.prepare("DELETE FROM votes WHERE listing_id NOT IN (SELECT id FROM listings)"),
};

function getSetting(key, fallback) {
  const row = statements.selectSetting.get(key);
  if (!row) {
    return fallback;
  }

  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function setSetting(key, value) {
  statements.upsertSetting.run(key, JSON.stringify(value ?? null));
}

function getVotes() {
  const rows = statements.selectVotes.all();
  const counts = {};
  const byListing = {};

  for (const row of rows) {
    counts[row.listing_id] = (counts[row.listing_id] || 0) + 1;
    if (!byListing[row.listing_id]) {
      byListing[row.listing_id] = [];
    }
    byListing[row.listing_id].push({
      voterId: row.voter_id,
      voterName: row.voter_name,
    });
  }

  return { counts, byListing, votes: rows };
}

function castVote(voterId, voterName, listingId) {
  const id = String(voterId || "").trim();
  const name = String(voterName || "").trim();
  const listing = String(listingId || "").trim();

  if (!id) {
    throw new Error("Voter id is required.");
  }
  if (!name) {
    throw new Error("Enter your name before voting.");
  }
  if (!listing) {
    throw new Error("Listing id is required.");
  }

  statements.upsertVote.run(id, listing, name);
  return getVotes();
}

function removeVote(voterId, listingId) {
  const id = String(voterId || "").trim();
  const listing = String(listingId || "").trim();

  if (!id) {
    throw new Error("Voter id is required.");
  }
  if (!listing) {
    throw new Error("Listing id is required.");
  }

  statements.deleteVote.run(id, listing);
  return getVotes();
}

function getState() {
  statements.deleteVotesNotInListings.run();

  const listings = statements.selectListings.all().map((row) => {
    try {
      return JSON.parse(row.data);
    } catch {
      return null;
    }
  });

  return {
    listings: listings.filter(Boolean),
    anchors: getSetting("anchors", []),
    selectedAnchor: getSetting("selectedAnchor", ""),
    mapsSettings: getSetting("mapsSettings", {}),
    votes: getVotes(),
  };
}

// Fields a person edits by hand (via the "Edit details" form) — locked when
// ALLOW_EDIT_LISTINGS=false, as opposed to fields the app itself keeps
// updating automatically (photos, cached images, travel times), which must
// keep flowing through regardless.
const USER_EDITABLE_FIELDS = ["price", "priceNights", "priceTotal", "guests", "bedrooms", "beds", "baths"];

function loadExistingListingsById() {
  const byId = new Map();
  for (const row of statements.selectListings.all()) {
    try {
      byId.set(String(row.id), JSON.parse(row.data));
    } catch {
      // Skip rows that fail to parse.
    }
  }
  return byId;
}

// When preserveExisting is set (ALLOW_REMOVE_LISTINGS=false), any listing
// currently stored but missing from `items` is kept rather than dropped, so
// the public-facing app can't remove listings — only add/edit/vote on them.
// When lockEditableFields is set (ALLOW_EDIT_LISTINGS=false), USER_EDITABLE_FIELDS
// on any already-existing listing are reset to their stored values regardless
// of what the incoming payload says, so hand-edits can't slip through while
// automatic updates (image caching, travel times) still apply normally.
function replaceListings(items, { preserveExisting = false, lockEditableFields = false } = {}) {
  const incoming = Array.isArray(items) ? items : [];
  let finalList = incoming;

  db.exec("BEGIN");
  try {
    const existingById = preserveExisting || lockEditableFields ? loadExistingListingsById() : null;

    if (lockEditableFields) {
      finalList = finalList.map((listing) => {
        if (!listing || listing.id == null) {
          return listing;
        }

        const existing = existingById.get(String(listing.id));
        if (!existing) {
          return listing;
        }

        const locked = { ...listing };
        for (const field of USER_EDITABLE_FIELDS) {
          locked[field] = existing[field];
        }
        return locked;
      });
    }

    if (preserveExisting) {
      const incomingIds = new Set(
        finalList.filter((listing) => listing?.id != null).map((listing) => String(listing.id)),
      );
      const preserved = [...existingById.entries()]
        .filter(([id]) => !incomingIds.has(id))
        .map(([, listing]) => listing);

      finalList = [...finalList, ...preserved];
    }

    statements.deleteAllListings.run();
    finalList.forEach((listing, index) => {
      if (listing && listing.id != null) {
        statements.insertListing.run(String(listing.id), JSON.stringify(listing), index);
      }
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  statements.deleteVotesNotInListings.run();
  return finalList.length;
}

function saveSettings(partial = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(partial, key);

  db.exec("BEGIN");
  try {
    if (has("anchors")) {
      setSetting("anchors", partial.anchors || []);
    }
    if (has("selectedAnchor")) {
      setSetting("selectedAnchor", partial.selectedAnchor || "");
    }
    if (has("mapsSettings")) {
      setSetting("mapsSettings", partial.mapsSettings || {});
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = { getState, replaceListings, saveSettings, getVotes, castVote, removeVote, dbPath };

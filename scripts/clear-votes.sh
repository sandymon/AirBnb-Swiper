#!/bin/sh
# Clears every vote from the running app's database (docker compose exec).
# Listings and settings are untouched. Run from the project directory on
# the server, alongside docker-compose.yml.
set -e

docker compose exec app node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.STAYSCOUT_DB);
const before = db.prepare('SELECT COUNT(*) c FROM votes').get().c;
db.exec('DELETE FROM votes');
console.log('Cleared ' + before + ' votes.');
db.close();
"

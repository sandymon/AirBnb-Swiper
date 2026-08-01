const fs = require("fs");
const html = fs.readFileSync("examplearibnblsiitng.txt", "utf8");

const muscache = [...new Set([...html.matchAll(/https:\/\/a0\.muscache\.com[^\s"'<>\\]+/g)].map((m) => m[0]))];
const listingPhotos = muscache.filter(
  (url) =>
    /im_pictures|Hosting-/.test(url) &&
    !/profile|avatar|icon|logo|favicon|badge/i.test(url),
);

console.log("Total muscache:", muscache.length);
console.log("Listing-like:", listingPhotos.length);
console.log("Sample:\n", listingPhotos.slice(0, 8).join("\n"));

const og = html.match(/property="og:image" content="([^"]+)"/i);
if (og) console.log("\nog:image", og[1]);

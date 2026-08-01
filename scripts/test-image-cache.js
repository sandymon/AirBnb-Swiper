const fs = require("fs");
const { cacheListingImages } = require("../image-cache");

const html = fs.readFileSync("examplearibnblsiitng.txt", "utf8");
const urls = [
  ...new Set(
    [...html.matchAll(/https:\/\/a0\.muscache\.com\/im\/pictures\/hosting\/[^"'\\<>\s]+/g)]
      .map((match) => match[0].split("?")[0])
      .filter((url) => url.includes("/original/")),
  ),
].slice(0, 3);

cacheListingImages(process.cwd(), "test-listing", urls)
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => console.error(error.message));

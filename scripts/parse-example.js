/**
 * Offline test against examplearibnblsiitng.txt (regex-based, no browser DOM).
 */
const fs = require("fs");
const html = fs.readFileSync("examplearibnblsiitng.txt", "utf8");

const overview = html.match(/data-section-id="OVERVIEW_DEFAULT_V2"[\s\S]{0,5000}/);
const overviewText = overview
  ? overview[0].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ")
  : "";

const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
const jsonLd = ldMatch ? JSON.parse(ldMatch[1]) : null;

const location = html.match(/data-section-id="LOCATION_DEFAULT"[\s\S]{0,3000}/);
const locationText = location
  ? location[0].replace(/<[^>]+>/g, "\n").replace(/\s+\n/g, "\n")
  : "";

const amenities = html.match(/data-section-id="AMENITIES_DEFAULT"[\s\S]{0,5000}/);
const amenityText = amenities ? amenities[0].replace(/<[^>]+>/g, " ") : "";

console.log(
  JSON.stringify(
    {
      title: jsonLd?.name,
      heading: overviewText.match(/Entire home in [^.]+/)?.[0],
      location: locationText
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.includes(",") && !/where you|exact location/i.test(l)),
      guests: overviewText.match(/(\d+)\s*guests/i)?.[1],
      bedrooms: overviewText.match(/(\d+(?:\.\d+)?)\s*bedrooms/i)?.[1],
      beds: overviewText.match(/(\d+(?:\.\d+)?)\s*beds/i)?.[1],
      baths: overviewText.match(/(\d+(?:\.\d+)?)\s*baths/i)?.[1],
      amenities: ["Pool", "Hot tub", "Workspace", "Parking"].filter((a) =>
        amenityText.toLowerCase().includes(a.toLowerCase()),
      ),
      prices: [...new Set(html.match(/\$[\d,]+/g) || [])].slice(0, 6),
    },
    null,
    2,
  ),
);

const scrapeBtn = document.getElementById("scrapeBtn");
const statusEl = document.getElementById("status");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type;
}

function isAirbnbUrl(url) {
  try {
    return new URL(url).hostname.includes("airbnb");
  } catch {
    return false;
  }
}

function setButtonsDisabled(disabled) {
  scrapeBtn.disabled = disabled;
}

async function ensureScraperLoaded(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["image-extractor.js", "parser.js", "content.js"],
  });
}

async function scrapeTab(tabId) {
  await ensureScraperLoaded(tabId);
  return chrome.tabs.sendMessage(tabId, { action: "scrape" });
}

async function relayToStayScout(listing) {
  const relayResult = await chrome.runtime.sendMessage({
    action: "relayListing",
    listing,
  });

  if (!relayResult?.success) {
    throw new Error(relayResult?.error || "Could not reach StayScout.");
  }
}

scrapeBtn.addEventListener("click", async () => {
  setStatus("Scraping listing and photo tour...", "pending");
  setButtonsDisabled(true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !isAirbnbUrl(tab.url)) {
      setStatus("Open an Airbnb listing page first.", "error");
      return;
    }

    const scrapeResult = await scrapeTab(tab.id);

    if (!scrapeResult?.success) {
      setStatus(scrapeResult?.error || "Could not scrape this page.", "error");
      return;
    }

    if ((scrapeResult.listing.images?.length || 0) < 2) {
      const fallback = await chrome.runtime.sendMessage({
        action: "fetchListingImages",
        url: tab.url,
      });

      if (fallback?.success && (fallback.images?.length || 0) > (scrapeResult.listing.images?.length || 0)) {
        scrapeResult.listing.images = fallback.images;
      }
    }

    setStatus("Sending to StayScout...", "pending");
    await relayToStayScout(scrapeResult.listing);

    const title = scrapeResult.listing.title || "Listing";
    const photoCount = scrapeResult.listing.images?.length || scrapeResult.imageCount || 0;
    const photoNote = photoCount > 1 ? ` (${photoCount} photos)` : "";
    setStatus(`Added "${title}"${photoNote} to StayScout.`, "success");
  } catch (error) {
    setStatus(error.message || "Something went wrong.", "error");
  } finally {
    setButtonsDisabled(false);
  }
});

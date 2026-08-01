const scrapeBtn = document.getElementById("scrapeBtn");
const photoTourBtn = document.getElementById("photoTourBtn");
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
  photoTourBtn.disabled = disabled;
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

async function extractPhotoTourTab(tabId) {
  await ensureScraperLoaded(tabId);
  return chrome.tabs.sendMessage(tabId, { action: "extractPhotoTour" });
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
  setStatus("Scraping listing...", "pending");
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

photoTourBtn.addEventListener("click", async () => {
  setStatus("Opening photo tour and collecting images...", "pending");
  setButtonsDisabled(true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !isAirbnbUrl(tab.url)) {
      setStatus("Open an Airbnb listing page first.", "error");
      return;
    }

    const tourResult = await extractPhotoTourTab(tab.id);

    if (!tourResult?.success) {
      setStatus(tourResult?.error || "Could not read the photo tour.", "error");
      return;
    }

    const photoCount = tourResult.imageCount || tourResult.listing?.images?.length || 0;
    if (!photoCount) {
      setStatus("No photos found in the photo tour modal.", "error");
      return;
    }

    setStatus(`Sending ${photoCount} photos to StayScout...`, "pending");
    await relayToStayScout(tourResult.listing);

    const title = tourResult.listing?.title || "Listing";
    setStatus(`Added ${photoCount} photos to "${title}".`, "success");
  } catch (error) {
    setStatus(error.message || "Something went wrong.", "error");
  } finally {
    setButtonsDisabled(false);
  }
});

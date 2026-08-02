importScripts("image-extractor.js");

const DEFAULT_STAYSCOUT_URL = "http://localhost:5173/";

async function getStayScoutUrl() {
  const stored = await chrome.storage.local.get("stayScoutUrl");
  return stored.stayScoutUrl || DEFAULT_STAYSCOUT_URL;
}

async function findStayScoutTab(targetUrl) {
  const origin = new URL(targetUrl).origin;
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  return tabs[0];
}

async function openStayScoutTab(targetUrl) {
  return chrome.tabs.create({ url: targetUrl, active: true });
}

async function sendListingToTab(tabId, listing) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (importedListing) => {
      const tryImport = (attempt = 0) => {
        if (typeof window.stayScoutImportListing === "function") {
          window.stayScoutImportListing(importedListing);
          return;
        }

        if (attempt < 40) {
          setTimeout(() => tryImport(attempt + 1), 250);
        }
      };

      tryImport();
    },
    args: [listing],
  });
}

async function relayListingToStayScout(listing) {
  const targetUrl = await getStayScoutUrl();
  let tab = await findStayScoutTab(targetUrl);

  if (!tab) {
    tab = await openStayScoutTab(targetUrl);
    await waitForTabLoad(tab.id);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } else {
    await chrome.tabs.update(tab.id, { active: true });
  }

  await sendListingToTab(tab.id, listing);
  return { tabId: tab.id };
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || tab.status === "complete") {
        resolve();
        return;
      }

      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

async function fetchListingImagesFromPage(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load listing page (${response.status}).`);
  }

  const html = await response.text();
  const hostingId = globalThis.stayScoutImageExtractor.hostingIdFromUrl(url);
  return globalThis.stayScoutImageExtractor.extractImagesFromHtml(html, hostingId);
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "fetchListingImages") {
    fetchListingImagesFromPage(request.url)
      .then((images) => sendResponse({ success: true, images }))
      .catch((error) => sendResponse({ success: false, error: error.message, images: [] }));
    return true;
  }

  if (request.action !== "relayListing") {
    return;
  }

  relayListingToStayScout(request.listing)
    .then(() => sendResponse({ success: true }))
    .catch((error) => sendResponse({ success: false, error: error.message }));

  return true;
});

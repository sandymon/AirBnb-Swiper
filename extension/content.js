if (!globalThis.__stayScoutScraperReady) {
  globalThis.__stayScoutScraperReady = true;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function listingUrl() {
    return window.location.href.split("?")[0];
  }

  async function waitForListingPhotoData(timeoutMs = 6000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const hasDeferredState = [...document.querySelectorAll('script[type="application/json"]')].some(
        (script) =>
          script.textContent?.includes("niobeClientData") &&
          script.textContent.includes("muscache.com/im/pictures/"),
      );

      if (hasDeferredState) {
        return;
      }

      await sleep(200);
    }
  }

  function getPhotoTourModal() {
    return document.querySelector('[role="dialog"][aria-label="Photo tour"]');
  }

  function clickShowAllPhotos() {
    const selectors = [
      '[data-testid="pdp-show-all-photos-button"]',
      'button[aria-label*="Show all photos"]',
      'button[aria-label*="show all photos"]',
      'a[href*="PHOTO_TOUR"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        element.click();
        return true;
      }
    }

    const match = [...document.querySelectorAll("button, a")].find((element) =>
      /show all photos/i.test(element.textContent || element.getAttribute("aria-label") || ""),
    );

    if (match) {
      match.click();
      return true;
    }

    return false;
  }

  async function openPhotoTourModal() {
    const existing = getPhotoTourModal();
    if (existing) {
      return existing;
    }

    const url = new URL(window.location.href);
    if (url.searchParams.get("modal") !== "PHOTO_TOUR_SCROLLABLE") {
      clickShowAllPhotos();
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const modal = getPhotoTourModal();
      if (modal) {
        return modal;
      }

      if (attempt === 8 && url.searchParams.get("modal") !== "PHOTO_TOUR_SCROLLABLE") {
        url.searchParams.set("modal", "PHOTO_TOUR_SCROLLABLE");
        window.history.pushState({}, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }

      await sleep(250);
    }

    throw new Error(
      'Photo tour did not open. Click "Show all photos" on the listing, or add ?modal=PHOTO_TOUR_SCROLLABLE to the URL.',
    );
  }

  function getModalScrollContainer(modal) {
    let best = modal;
    let bestOverflow = 0;

    modal.querySelectorAll("div").forEach((element) => {
      const overflow = element.scrollHeight - element.clientHeight;
      if (overflow > bestOverflow) {
        bestOverflow = overflow;
        best = element;
      }
    });

    return best;
  }

  async function scrollModalToLoadImages(modal) {
    const container = getModalScrollContainer(modal);
    let stablePasses = 0;
    let lastCount = 0;

    for (let pass = 0; pass < 45; pass += 1) {
      container.scrollTop = container.scrollHeight;
      await sleep(180);

      const count = modal.querySelectorAll('img[data-original-uri], img[src*="muscache.com"]').length;
      if (count === lastCount) {
        stablePasses += 1;
        if (stablePasses >= 3) {
          break;
        }
      } else {
        stablePasses = 0;
        lastCount = count;
      }
    }

    container.scrollTop = 0;
    await sleep(200);
  }

  async function extractPhotoTourImages() {
    const modal = await openPhotoTourModal();
    await scrollModalToLoadImages(modal);

    const images = globalThis.stayScoutImageExtractor.extractImagesFromPhotoTourModal(modal, listingUrl());

    return {
      url: listingUrl(),
      images,
      photosOnly: true,
      title: document.querySelector("h1")?.textContent?.trim() || "Listing",
    };
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "scrape") {
      (async () => {
        try {
          await waitForListingPhotoData();
          const listing = scrapeAirbnbPage();
          sendResponse({ success: true, listing, imageCount: listing.images?.length || 0 });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();

      return true;
    }

    if (request.action === "extractPhotoTour") {
      (async () => {
        try {
          const payload = await extractPhotoTourImages();
          sendResponse({
            success: true,
            listing: payload,
            imageCount: payload.images?.length || 0,
          });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();

      return true;
    }

    return undefined;
  });
}

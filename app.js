const storageKey = "stayscout-listings";
const anchorsStorageKey = "stayscout-anchors";
const selectedAnchorKey = "stayscout-selected-anchor";
const mapsSettingsKey = "stayscout-maps-settings";
const voterIdKey = "stayscout-voter-id";
const voterNameKey = "stayscout-voter-name";
const fullscreenDismissedKey = "stayscout-fullscreen-dismissed";
const onboardingSeenKey = "stayscout-onboarding-seen";
const SWIPE_THRESHOLD = 88;
const SWIPE_OFF_RATIO = 1.15;

const DEFAULT_NYC_ANCHOR = {
  id: "nyc",
  label: "New York City",
  address: "New York, NY, USA",
  lat: 40.7128,
  lng: -74.006,
  placeId: null,
};

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    if (response.status === 405) {
      throw new Error("Server needs a restart to enable this feature. Stop and run node server.js again.");
    }
    throw new Error(text.slice(0, 120) || "Unexpected server response.");
  }
}

const api = {
  async getState() {
    const response = await fetch("/api/state");
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Could not load saved data.");
    }
    return data;
  },
  async getConfig() {
    const response = await fetch("/api/config");
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Could not load server configuration.");
    }
    return data;
  },
  async setVote(voterId, voterName, listingId, vote) {
    const response = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voterId, voterName, listingId, vote }),
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Could not save vote.");
    }
    return data.votes;
  },
};

function createPersister(url, buildBody) {
  let running = false;
  let dirty = false;

  async function flush() {
    running = true;
    while (dirty) {
      dirty = false;
      try {
        await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBody()),
        });
      } catch (error) {
        console.error(`StayScout: could not save to ${url}`, error);
      }
    }
    running = false;
    if (dirty) {
      flush();
    }
  }

  return function schedule() {
    if (hydrating) {
      return;
    }
    dirty = true;
    if (!running) {
      flush();
    }
  };
}

const swipeCardTemplate = document.querySelector("#swipeCardTemplate");
const listingCardTemplate = document.querySelector("#listingCardTemplate");
const swipeView = document.querySelector("#swipeView");
const homeView = document.querySelector("#homeView");
const swipeStack = document.querySelector("#swipeStack");
const resultsGrid = document.querySelector("#resultsGrid");
const homeLeaderboard = document.querySelector("#homeLeaderboard");
const leaderboardList = document.querySelector("#leaderboardList");
const swipePassBtn = document.querySelector("#swipePassBtn");
const swipeLikeBtn = document.querySelector("#swipeLikeBtn");
const swipeInfoBtn = document.querySelector("#swipeInfoBtn");
const swipeAgainBtn = document.querySelector("#swipeAgainBtn");
const resetVotingBtn = document.querySelector("#resetVotingBtn");
const settingsResetVotingBtn = document.querySelector("#settingsResetVotingBtn");
const settingsOverlay = document.querySelector("#settingsOverlay");
const settingsBtn = document.querySelector("#settingsBtn");
const topBarTag = document.querySelector("#topBarTag");
const listingDetailOverlay = document.querySelector("#listingDetailOverlay");
const photoLightbox = document.querySelector("#photoLightbox");
const fullscreenPrompt = document.querySelector("#fullscreenPrompt");
const fullscreenEnableBtn = document.querySelector("#fullscreenEnableBtn");
const fullscreenDismissBtn = document.querySelector("#fullscreenDismissBtn");
const onboardingOverlay = document.querySelector("#onboardingOverlay");
const onboardingSteps = [...(onboardingOverlay?.querySelectorAll(".onboarding-step") || [])];
const onboardingDots = [...(onboardingOverlay?.querySelectorAll(".onboarding-dot") || [])];
const onboardingBackBtn = document.querySelector("[data-onboarding-back]");
const onboardingNextBtn = document.querySelector("[data-onboarding-next]");
const onboardingSkipBtn = document.querySelector("[data-onboarding-skip]");
const replayOnboardingBtn = document.querySelector("#replayOnboardingBtn");

const detailFields = {
  panel: listingDetailOverlay?.querySelector(".listing-detail-panel"),
  galleryImage: listingDetailOverlay?.querySelector(".gallery-image"),
  galleryEmpty: listingDetailOverlay?.querySelector(".gallery-empty"),
  galleryPrev: listingDetailOverlay?.querySelector(".gallery-prev"),
  galleryNext: listingDetailOverlay?.querySelector(".gallery-next"),
  galleryCounter: listingDetailOverlay?.querySelector(".gallery-counter"),
  galleryStage: listingDetailOverlay?.querySelector(".gallery-stage"),
  galleryFullscreen: listingDetailOverlay?.querySelector(".gallery-fullscreen"),
  galleryRooms: listingDetailOverlay?.querySelector(".gallery-rooms"),
  galleryCaption: listingDetailOverlay?.querySelector(".gallery-caption"),
  driveTime: listingDetailOverlay?.querySelector(".detail-drive-time"),
  priceBadge: listingDetailOverlay?.querySelector(".price-badge"),
  price: listingDetailOverlay?.querySelector(".detail-price"),
  priceUnit: listingDetailOverlay?.querySelector(".detail-price-unit"),
  priceBreakdown: listingDetailOverlay?.querySelector(".detail-price-breakdown"),
  title: listingDetailOverlay?.querySelector(".detail-title"),
  area: listingDetailOverlay?.querySelector(".detail-area"),
  facts: listingDetailOverlay?.querySelector(".detail-facts"),
  amenities: listingDetailOverlay?.querySelector(".detail-amenities"),
  link: listingDetailOverlay?.querySelector(".detail-link"),
  voteButton: listingDetailOverlay?.querySelector(".detail-vote-button"),
  voteCount: listingDetailOverlay?.querySelector(".detail-vote-count"),
  voteVoters: listingDetailOverlay?.querySelector(".detail-vote-voters"),
  remove: listingDetailOverlay?.querySelector(".detail-remove"),
};

const lightboxFields = {
  image: photoLightbox?.querySelector(".lightbox-image"),
  prev: photoLightbox?.querySelector(".lightbox-prev"),
  next: photoLightbox?.querySelector(".lightbox-next"),
  counter: photoLightbox?.querySelector(".lightbox-counter"),
  stage: photoLightbox?.querySelector(".photo-lightbox-stage"),
};

let detailContext = null;
let lightboxOpen = false;

const fields = {
  anchorSelect: document.querySelector("#anchorSelect"),
  anchorSearchInput: document.querySelector("#anchorSearchInput"),
  anchorList: document.querySelector("#anchorList"),
  travelMode: document.querySelector("#travelMode"),
  mapsKeyStatus: document.querySelector("#mapsKeyStatus"),
  travelStatus: document.querySelector("#travelStatus"),
  sortBy: document.querySelector("#sortBy"),
  listingCount: document.querySelector("#listingCount"),
  homeBaseSummary: document.querySelector("#homeBaseSummary"),
  voterNameInput: document.querySelector("#voterNameInput"),
};

let anchors = [];
let listings = [];
let voteData = { counts: {}, byListing: {} };
let voterId = "";
let selectedAnchorId = "";
let mapsSettings = {};
let serverGoogleKey = "";
let allowRemoveListings = true;
let hydrating = true;
let placesAutocomplete = null;
let googleMapsLoadPromise = null;
let swipeBusy = false;
let activeSwipeListing = null;
let activeSwipeSettings = null;

const persistListings = createPersister("/api/listings", () => ({ listings }));
const persistSettings = createPersister("/api/settings", () => ({
  anchors,
  selectedAnchor: selectedAnchorId,
  mapsSettings: {
    travelMode: fields.travelMode.value,
  },
}));

function ensureDefaultAnchor() {
  if (anchors.length) {
    return;
  }

  anchors = [DEFAULT_NYC_ANCHOR];
  selectedAnchorId = DEFAULT_NYC_ANCHOR.id;
}

function hasSwipeDeck(settings) {
  return listings.length > 0 && getSwipeDeck(settings).length > 0;
}

function openSettings() {
  if (!settingsOverlay) {
    return;
  }

  settingsOverlay.hidden = false;
  document.body.classList.add("settings-open");
  settingsOverlay.querySelector(".settings-panel")?.focus();
  setupPlacesAutocomplete();
}

function closeSettings() {
  if (!settingsOverlay) {
    return;
  }

  settingsOverlay.hidden = true;
  document.body.classList.remove("settings-open");
}

function setupSettingsOverlay() {
  if (!settingsOverlay) {
    return;
  }

  settingsBtn?.addEventListener("click", openSettings);
  settingsOverlay.querySelectorAll("[data-close-settings]").forEach((element) => {
    element.addEventListener("click", closeSettings);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && settingsOverlay && !settingsOverlay.hidden) {
      closeSettings();
    }
  });
}

function supportsFullscreen() {
  return Boolean(document.documentElement.requestFullscreen);
}

function updateFullscreenPrompt() {
  if (!fullscreenPrompt) {
    return;
  }

  const dismissed = localStorage.getItem(fullscreenDismissedKey) === "1";
  fullscreenPrompt.hidden = !supportsFullscreen() || Boolean(document.fullscreenElement) || dismissed;
}

async function enterFullscreen() {
  try {
    await document.documentElement.requestFullscreen();
  } catch (error) {
    setTravelStatus(`Could not enter fullscreen: ${error.message}`, true);
  }
}

function setupFullscreenPrompt() {
  if (!fullscreenPrompt) {
    return;
  }

  fullscreenEnableBtn?.addEventListener("click", enterFullscreen);
  fullscreenDismissBtn?.addEventListener("click", () => {
    localStorage.setItem(fullscreenDismissedKey, "1");
    updateFullscreenPrompt();
  });

  document.addEventListener("fullscreenchange", updateFullscreenPrompt);
  updateFullscreenPrompt();
}

let onboardingStepIndex = 0;

function renderOnboardingStep() {
  onboardingSteps.forEach((step, index) => {
    step.classList.toggle("is-active", index === onboardingStepIndex);
  });

  onboardingDots.forEach((dot, index) => {
    dot.classList.toggle("is-active", index === onboardingStepIndex);
  });

  if (onboardingBackBtn) {
    onboardingBackBtn.hidden = onboardingStepIndex === 0;
  }

  if (onboardingNextBtn) {
    onboardingNextBtn.textContent =
      onboardingStepIndex === onboardingSteps.length - 1 ? "Start swiping" : "Next";
  }
}

function openOnboarding() {
  if (!onboardingOverlay) {
    return;
  }

  onboardingStepIndex = 0;
  renderOnboardingStep();
  onboardingOverlay.hidden = false;
  document.body.classList.add("onboarding-open");
  onboardingOverlay.querySelector(".onboarding-panel")?.focus();
}

function closeOnboarding() {
  if (!onboardingOverlay) {
    return;
  }

  onboardingOverlay.hidden = true;
  document.body.classList.remove("onboarding-open");
  localStorage.setItem(onboardingSeenKey, "1");
}

function setupOnboarding() {
  if (!onboardingOverlay) {
    return;
  }

  onboardingNextBtn?.addEventListener("click", () => {
    if (onboardingStepIndex >= onboardingSteps.length - 1) {
      closeOnboarding();
      return;
    }

    onboardingStepIndex += 1;
    renderOnboardingStep();
  });

  onboardingBackBtn?.addEventListener("click", () => {
    onboardingStepIndex = Math.max(0, onboardingStepIndex - 1);
    renderOnboardingStep();
  });

  onboardingSkipBtn?.addEventListener("click", closeOnboarding);

  replayOnboardingBtn?.addEventListener("click", () => {
    closeSettings();
    openOnboarding();
  });

  document.addEventListener("keydown", (event) => {
    if (!onboardingOverlay.hidden && event.key === "Escape") {
      closeOnboarding();
    }
  });

  if (!localStorage.getItem(onboardingSeenKey)) {
    openOnboarding();
  }
}

function setTravelStatus(message, isError = false) {
  if (!fields.travelStatus) {
    return;
  }

  fields.travelStatus.textContent = message;
  fields.travelStatus.className = isError ? "status status--floating error" : "status status--floating";
  fields.travelStatus.hidden = !message;
}

function formatPrice(amount) {
  return `$${Number(amount).toLocaleString()}`;
}

// Show the total stay price as the headline figure, with the nightly rate kept
// as a breakdown that stays collapsed until the price is clicked.
function applyPriceBadge({ priceEl, unitEl, breakdownEl }, listing) {
  const hasBreakdown = Boolean(listing.priceNights && listing.priceTotal);

  if (hasBreakdown) {
    const nightWord = listing.priceNights === 1 ? "night" : "nights";
    priceEl.textContent = formatPrice(listing.priceTotal);
    unitEl.textContent = `total · ${listing.priceNights} ${nightWord}`;
    breakdownEl.textContent =
      listing.price != null ? `${formatPrice(listing.price)} / night` : "";
    breakdownEl.hidden = true;
  } else {
    priceEl.textContent = listing.price != null ? formatPrice(listing.price) : "--";
    unitEl.textContent = "/ night";
    breakdownEl.textContent = "";
    breakdownEl.hidden = true;
  }
}

function setupPriceToggle(badge, listing) {
  const breakdownEl = badge.querySelector(".price-breakdown");
  const hasBreakdown = Boolean(listing.priceNights && listing.priceTotal);

  badge.classList.toggle("price-badge--interactive", hasBreakdown);

  if (!hasBreakdown) {
    badge.removeAttribute("aria-expanded");
    badge.classList.remove("is-open");
    badge.onclick = null;
    return;
  }

  badge.setAttribute("aria-expanded", "false");
  badge.classList.remove("is-open");
  badge.onclick = (event) => {
    event.stopPropagation();
    const willOpen = breakdownEl.hidden;
    breakdownEl.hidden = !willOpen;
    badge.classList.toggle("is-open", willOpen);
    badge.setAttribute("aria-expanded", String(willOpen));
  };
}

function getVoterId() {
  let id = localStorage.getItem(voterIdKey);
  if (!id) {
    id = makeId();
    localStorage.setItem(voterIdKey, id);
  }
  return id;
}

function getVoterName() {
  return (fields.voterNameInput?.value || localStorage.getItem(voterNameKey) || "").trim();
}

function saveVoterName(name) {
  const trimmed = String(name || "").trim();
  if (trimmed) {
    localStorage.setItem(voterNameKey, trimmed);
  }
}

function getVoteCount(listingId) {
  return voteData.counts[listingId] || 0;
}

function getVotersForListing(listingId) {
  return voteData.byListing[listingId] || [];
}

function isVotedByMe(listingId) {
  return getVotersForListing(listingId).some((voter) => voter.voterId === voterId);
}

function getLeadingListingId() {
  let leaderId = null;
  let topCount = 0;

  for (const [listingId, count] of Object.entries(voteData.counts)) {
    if (count > topCount) {
      topCount = count;
      leaderId = listingId;
    }
  }

  return topCount > 0 ? leaderId : null;
}

function formatVoterNames(listingId) {
  const voters = getVotersForListing(listingId);
  if (!voters.length) {
    return "";
  }

  return voters.map((voter) => voter.voterName).join(", ");
}

function applyVoteButton(button, listing) {
  const count = getVoteCount(listing.id);
  const voted = isVotedByMe(listing.id);
  const countEl = button.querySelector(".vote-count");

  if (countEl) {
    countEl.textContent = String(count);
  }

  button.classList.toggle("vote-button--active", voted);
  button.setAttribute("aria-pressed", String(voted));
  button.title = voted
    ? "Remove your vote"
    : count
      ? `${formatVoterNames(listing.id)} voted`
      : "Vote for this stay";
}

async function voteForListing(listingId) {
  const name = getVoterName();
  if (!name) {
    openSettings();
    fields.voterNameInput?.focus();
    setTravelStatus("Enter your name in settings before voting.", true);
    return false;
  }

  saveVoterName(name);

  if (isVotedByMe(listingId)) {
    return true;
  }

  try {
    voteData = await api.setVote(voterId, name, listingId, true);
    return true;
  } catch (error) {
    setTravelStatus(error.message, true);
    return false;
  }
}

async function toggleVote(listingId) {
  const name = getVoterName();
  if (!name) {
    openSettings();
    fields.voterNameInput?.focus();
    setTravelStatus("Enter your name in settings before voting.", true);
    return;
  }

  saveVoterName(name);

  try {
    const nextVote = !isVotedByMe(listingId);
    voteData = await api.setVote(voterId, name, listingId, nextVote);
    render();

    if (detailContext?.listing.id === listingId) {
      populateListingDetail();
    }
  } catch (error) {
    setTravelStatus(error.message, true);
  }
}

async function refreshVotes() {
  try {
    const state = await api.getState();
    voteData = state.votes || { counts: {}, byListing: {} };
  } catch {
    // Keep existing vote data if refresh fails.
  }
}

function formatTravelDuration(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) {
    return "--";
  }

  const totalMinutes = Math.round(minutes);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

function makeId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `stay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slugifyAnchor(label) {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || `anchor-${Date.now()}`;
}

function loadAnchors() {
  const stored = localStorage.getItem(anchorsStorageKey);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return parsed
      .filter((anchor) => !anchor.builtIn)
      .map(normalizeAnchor)
      .filter((anchor) => anchor.address);
  } catch {
    return [];
  }
}

function normalizeAnchor(anchor) {
  return {
    id: anchor.id,
    label: anchor.label || anchor.address || "Location",
    address: anchor.address || anchor.location || anchor.label || "",
    lat: anchor.lat ?? null,
    lng: anchor.lng ?? null,
    placeId: anchor.placeId ?? null,
  };
}

function saveAnchors() {
  persistSettings();
}

function setSelectedAnchor(id) {
  selectedAnchorId = id || "";
  persistSettings();
}

function getAnchorById(anchorId) {
  return anchors.find((anchor) => anchor.id === anchorId);
}

function getAnchorLabel(anchorId) {
  const anchor = getAnchorById(anchorId);
  return anchor?.label || anchor?.address || anchorId;
}

function getConfiguredAnchors() {
  return anchors.filter((anchor) => anchor.address?.trim());
}

function buildDefaultTimes(existingTimes = {}) {
  return Object.fromEntries(
    anchors.map((anchor) => [anchor.id, existingTimes[anchor.id] ?? null]),
  );
}

function getGoogleApiKey() {
  return serverGoogleKey || "";
}

function renderAnchorSelect() {
  const previousValue = fields.anchorSelect.value || selectedAnchorId;
  fields.anchorSelect.replaceChildren();

  if (!anchors.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Add a starting location first";
    fields.anchorSelect.append(option);
    fields.anchorSelect.disabled = true;
    return;
  }

  fields.anchorSelect.disabled = false;
  anchors.forEach((anchor) => {
    const option = document.createElement("option");
    option.value = anchor.id;
    option.textContent = anchor.label;
    fields.anchorSelect.append(option);
  });

  const hasPrevious = anchors.some((anchor) => anchor.id === previousValue);
  fields.anchorSelect.value = hasPrevious ? previousValue : anchors[0].id;
  setSelectedAnchor(fields.anchorSelect.value);
}

function renderAnchorList() {
  fields.anchorList.replaceChildren();

  if (!anchors.length) {
    const empty = document.createElement("li");
    empty.className = "anchor-empty";
    empty.textContent = "No home base yet — search above.";
    fields.anchorList.append(empty);
    fields.homeBaseSummary.textContent = "Add where you're traveling from";
    return;
  }

  const primary = getAnchorById(fields.anchorSelect.value) || anchors[0];
  fields.homeBaseSummary.textContent = primary
    ? `${primary.label} · ${primary.address}`
    : "Add where you're traveling from";

  anchors.forEach((anchor) => {
    const item = document.createElement("li");
    item.className = "anchor-chip";
    item.title = anchor.address;

    const label = document.createElement("span");
    label.textContent = anchor.label;
    item.append(label);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Remove ${anchor.label}`);
    removeButton.textContent = "✕";
    removeButton.addEventListener("click", () => removeAnchor(anchor.id));
    item.append(removeButton);

    fields.anchorList.append(item);
  });
}

function loadGoogleMaps() {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    return Promise.reject(
      new Error("Set GOOGLE_MAPS_API_KEY in the server's .env file to search addresses."),
    );
  }

  if (window.google?.maps?.places) {
    return Promise.resolve(window.google.maps);
  }

  if (googleMapsLoadPromise) {
    return googleMapsLoadPromise;
  }

  googleMapsLoadPromise = new Promise((resolve, reject) => {
    const callbackName = "stayScoutGoogleMapsInit";

    window.gm_authFailure = () => {
      googleMapsLoadPromise = null;
      reject(
        new Error(
          "Google Maps API is not enabled for this key. Turn on Maps JavaScript API and Places API in Google Cloud Console, then refresh this page.",
        ),
      );
    };

    window[callbackName] = () => {
      delete window[callbackName];
      delete window.gm_authFailure;
      resolve(window.google.maps);
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      googleMapsLoadPromise = null;
      delete window.gm_authFailure;
      reject(new Error("Could not load Google Maps."));
    };
    document.head.append(script);
  });

  return googleMapsLoadPromise;
}

async function setupPlacesAutocomplete() {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    fields.anchorSearchInput.disabled = true;
    fields.anchorSearchInput.placeholder = "Set GOOGLE_MAPS_API_KEY in .env to search addresses";
    return;
  }

  fields.anchorSearchInput.disabled = false;
  fields.anchorSearchInput.placeholder = "Start typing an address, e.g. Bronx, NY";

  try {
    const maps = await loadGoogleMaps();

    if (placesAutocomplete) {
      google.maps.event.clearInstanceListeners(placesAutocomplete);
    }

    placesAutocomplete = new maps.places.Autocomplete(fields.anchorSearchInput, {
      fields: ["formatted_address", "geometry", "name", "place_id"],
      types: ["geocode", "establishment"],
    });

    placesAutocomplete.addListener("place_changed", () => {
      const place = placesAutocomplete.getPlace();
      if (!place.geometry?.location) {
        setTravelStatus("Pick a location from the Google suggestions.", true);
        return;
      }

      addAnchorFromPlace(place);
      fields.anchorSearchInput.value = "";
    });
  } catch (error) {
    setTravelStatus(error.message, true);
  }
}

async function addAnchorFromPlace(place) {
  const address = place.formatted_address || place.name;
  const label = place.name || address.split(",")[0];
  const lat = place.geometry.location.lat();
  const lng = place.geometry.location.lng();
  const placeId = place.place_id;

  const duplicate = anchors.some(
    (anchor) => anchor.placeId === placeId || anchor.address.toLowerCase() === address.toLowerCase(),
  );
  if (duplicate) {
    setTravelStatus("That location is already saved.", true);
    return;
  }

  let id = slugifyAnchor(label);
  if (anchors.some((anchor) => anchor.id === id)) {
    id = `${id}-${Date.now()}`;
  }

  anchors.push({ id, label, address, lat, lng, placeId });
  saveAnchors();
  renderAnchorSelect();
  renderAnchorList();
  fields.anchorSelect.value = id;
  setSelectedAnchor(id);
  render();

  setTravelStatus(`Added ${label}. Calculating travel times for saved stays...`);

  try {
    await calculateAllTravelTimes({ silent: true });
    setTravelStatus(`Added ${label} and updated travel times for all saved stays.`);
  } catch (error) {
    setTravelStatus(`Added ${label}, but travel time update failed: ${error.message}`, true);
  }
}

async function removeAnchor(anchorId) {
  anchors = anchors.filter((item) => item.id !== anchorId);
  listings = listings.map((listing) => {
    const times = { ...listing.times };
    delete times[anchorId];
    return { ...listing, times };
  });

  saveAnchors();
  saveListings();
  renderAnchorSelect();
  renderAnchorList();
  render();
}

function loadMapsSettings() {
  return mapsSettings || {};
}

function saveMapsSettings() {
  mapsSettings = {
    travelMode: fields.travelMode.value,
  };
  persistSettings();
}

function applyMapsSettings() {
  const settings = loadMapsSettings();
  if (settings.travelMode) {
    fields.travelMode.value = settings.travelMode;
  }
}

async function loadServerConfig() {
  try {
    const config = await api.getConfig();
    serverGoogleKey = config.googleMapsApiKey || "";
    allowRemoveListings = config.allowRemoveListings !== false;
  } catch (error) {
    serverGoogleKey = "";
    console.error("StayScout: could not load server configuration.", error);
  }

  updateMapsKeyStatus();
}

function updateMapsKeyStatus() {
  if (!fields.mapsKeyStatus) {
    return;
  }

  if (serverGoogleKey) {
    fields.mapsKeyStatus.textContent = "Configured from server .env";
    fields.mapsKeyStatus.className = "key-status key-ok";
  } else {
    fields.mapsKeyStatus.textContent = "Not set — using free OSRM driving times";
    fields.mapsKeyStatus.className = "key-status key-missing";
  }
}

function getListingDestination(listing) {
  return (listing.location || listing.area || "").trim();
}

function formatTravelErrors(errors = {}) {
  const entries = Object.entries(errors);
  if (!entries.length) {
    return "";
  }

  return ` Some anchors failed: ${entries.map(([id, message]) => `${getAnchorLabel(id)} (${message})`).join(", ")}.`;
}

async function fetchTravelTimes(destination) {
  saveMapsSettings();

  const response = await fetch("/api/travel-times", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      destination,
      anchors,
      mode: fields.travelMode.value,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not calculate travel times.");
  }

  return data;
}

async function updateListingTravelTimes(listingId, options = {}) {
  const listing = listings.find((item) => item.id === listingId);
  if (!listing) {
    return null;
  }

  const destination = getListingDestination(listing);
  if (!destination) {
    throw new Error(`Add a destination for "${listing.title}" first.`);
  }

  const configuredAnchors = getConfiguredAnchors();
  if (!configuredAnchors.length) {
    throw new Error("Add a starting location first.");
  }

  if (!options.silent) {
    setTravelStatus(`Calculating travel times for ${listing.title}...`);
  }

  const result = await fetchTravelTimes(destination);
  listing.times = { ...buildDefaultTimes(listing.times), ...result.times };
  saveListings();
  return result;
}

async function calculateAllTravelTimes(options = {}) {
  const targets = listings.filter((listing) => getListingDestination(listing));

  if (!getConfiguredAnchors().length) {
    throw new Error("Add a starting location first.");
  }

  if (!targets.length) {
    throw new Error("No saved stays have a destination to route to.");
  }

  if (!options.silent) {
    setTravelStatus(`Calculating travel times for ${targets.length} stays...`);
  }

  let provider = "";
  const errors = [];

  for (const listing of targets) {
    try {
      const result = await updateListingTravelTimes(listing.id, { silent: true });
      provider = result.provider;
      if (Object.keys(result.errors || {}).length) {
        errors.push(`${listing.title}${formatTravelErrors(result.errors)}`);
      }
    } catch (error) {
      errors.push(`${listing.title}: ${error.message}`);
    }
  }

  render();

  if (errors.length) {
    if (!options.silent) {
      setTravelStatus(`Finished with some issues. ${errors.join(" ")}`, true);
    }
  } else if (!options.silent) {
    setTravelStatus(
      `Updated travel times for ${targets.length} ${targets.length === 1 ? "stay" : "stays"} using ${provider || "maps"}.`,
    );
  }
}

function hydrateListing(listing) {
  return {
    ...listing,
    times: buildDefaultTimes(listing.times),
  };
}

function saveListings() {
  persistListings();
}

function getViewSettings() {
  const anchorId = fields.anchorSelect.value || anchors[0]?.id || "";

  return {
    anchor: anchorId,
    anchorLabel: getAnchorLabel(anchorId),
    sortBy: fields.sortBy.value,
  };
}

function sortListings(items, settings) {
  const sorters = {
    votes: (a, b) => {
      const voteDiff = getVoteCount(b.id) - getVoteCount(a.id);
      if (voteDiff !== 0) {
        return voteDiff;
      }
      return (a.times[settings.anchor] ?? Infinity) - (b.times[settings.anchor] ?? Infinity);
    },
    time: (a, b) => (a.times[settings.anchor] ?? Infinity) - (b.times[settings.anchor] ?? Infinity),
    price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  };

  return [...items].sort(sorters[settings.sortBy] || sorters.votes);
}

function getPassedStorageKey() {
  return `stayscout-passed-${voterId || "guest"}`;
}

function getPassedIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(getPassedStorageKey()) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addPassedId(listingId) {
  const passed = new Set(getPassedIds());
  passed.add(listingId);
  localStorage.setItem(getPassedStorageKey(), JSON.stringify([...passed]));
}

function clearPassedIds() {
  localStorage.removeItem(getPassedStorageKey());
}

function resetVoting() {
  if (!listings.length) {
    setTravelStatus("Import stays first, then you can vote.", true);
    return;
  }

  clearPassedIds();
  closeSettings();
  setTravelStatus("Starting fresh — swipe through the stays again.");
  render();
}

function getSwipeDeck(settings) {
  const passed = new Set(getPassedIds());
  return sortListings(listings, settings).filter((listing) => !passed.has(listing.id));
}

function render() {
  const settings = getViewSettings();
  const swipeMode = hasSwipeDeck(settings);

  document.body.classList.toggle("mode-swipe", swipeMode);
  document.body.classList.toggle("mode-home", !swipeMode);

  if (swipeMode) {
    swipeView.hidden = false;
    homeView.hidden = true;
    if (topBarTag) {
      topBarTag.textContent = "Swipe right to vote · left to pass";
    }
    renderSwipeArena(settings);
  } else {
    swipeView.hidden = true;
    homeView.hidden = false;
    if (topBarTag) {
      topBarTag.textContent = listings.length
        ? "All stays · compare and pick the winner"
        : "Import stays to get started";
    }
    renderHomeScreen(settings);
  }

  updateBoard(settings);
}

function renderHomeScreen(settings) {
  const sorted = sortListings(listings, settings);
  resultsGrid.replaceChildren();

  if (!sorted.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML =
      "<strong>No stays yet</strong>Import listings from Airbnb with the StayScout extension.";
    resultsGrid.append(emptyState);
  } else {
    sorted.forEach((listing) =>
      resultsGrid.append(createListingCard(listing, settings.anchorLabel, settings.anchor)),
    );
  }

  renderLeaderboard(settings);
}

function renderSwipeArena(settings) {
  swipeStack.replaceChildren();
  activeSwipeListing = null;
  activeSwipeSettings = settings;

  const deck = getSwipeDeck(settings);
  const visible = deck.slice(0, 2).reverse();
  visible.forEach((listing, index) => {
    const isTop = index === visible.length - 1;
    swipeStack.append(createSwipeCard(listing, settings, isTop));
  });

  wireSwipeActionButtons(deck[0], settings);
}

function createSwipeCard(listing, settings, isTop) {
  const card = swipeCardTemplate.content.firstElementChild.cloneNode(true);
  const anchorId = settings.anchor;
  const travelMinutes = listing.times[anchorId];
  const photo = card.querySelector(".swipe-photo");
  const photoEmpty = card.querySelector(".swipe-photo-empty");

  fillListingPhoto(photo, photoEmpty, listing);
  if (photo.isConnected) {
    photo.alt = listing.title;
  }

  card.querySelector(".drive-time").textContent = formatTravelDuration(travelMinutes);
  applyPriceBadge(
    {
      priceEl: card.querySelector(".price"),
      unitEl: card.querySelector(".price-unit"),
      breakdownEl: document.createElement("span"),
    },
    listing,
  );

  card.querySelector(".swipe-card-title").textContent = listing.title;
  card.querySelector(".swipe-card-area").textContent = listing.area || "Location pending";

  const facts = card.querySelector(".swipe-card-facts");
  const factItems = [
    listing.rating != null && `★ ${listing.rating.toFixed(1)}`,
    listing.bedrooms != null && `${listing.bedrooms} bd`,
    listing.guests != null && `${listing.guests} guests`,
    listing.beds != null && `${listing.beds} beds`,
    listing.baths != null && `${listing.baths} baths`,
  ].filter(Boolean);

  factItems.forEach((text) => {
    const fact = document.createElement("span");
    fact.className = "fact";
    fact.textContent = text;
    facts.append(fact);
  });

  const voteCount = getVoteCount(listing.id);
  card.querySelector(".swipe-vote-count").textContent = String(voteCount);
  const voterNames = formatVoterNames(listing.id);
  card.querySelector(".swipe-voter-names").textContent = voterNames
    ? ` · ${voterNames}`
    : "";

  if (getLeadingListingId() === listing.id) {
    card.classList.add("swipe-card--leading");
  }

  if (isTop) {
    card.classList.add("swipe-card--top");
    setupSwipeCard(card, listing, settings);
    activeSwipeListing = listing;
  } else {
    card.classList.add("swipe-card--behind");
  }

  return card;
}

function setupSwipeCard(card, listing, settings) {
  const nopeStamp = card.querySelector(".swipe-stamp--nope");
  const likeStamp = card.querySelector(".swipe-stamp--like");
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let deltaX = 0;

  const setTransform = (x, animate = false) => {
    card.style.transition = animate ? "transform 0.32s ease, opacity 0.32s ease" : "";
    const rotate = Math.max(-18, Math.min(18, x * 0.06));
    card.style.transform = `translateX(${x}px) rotate(${rotate}deg)`;

    const progress = Math.min(1, Math.abs(x) / SWIPE_THRESHOLD);
    if (x > 0) {
      likeStamp.style.opacity = String(progress);
      nopeStamp.style.opacity = "0";
    } else if (x < 0) {
      nopeStamp.style.opacity = String(progress);
      likeStamp.style.opacity = "0";
    } else {
      nopeStamp.style.opacity = "0";
      likeStamp.style.opacity = "0";
    }
  };

  const resetCard = (animate = true) => {
    deltaX = 0;
    setTransform(0, animate);
    card.style.opacity = "";
  };

  const onPointerDown = (event) => {
    if (swipeBusy || !event.isPrimary) {
      return;
    }
    if (event.target.closest("a, button")) {
      return;
    }

    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    card.setPointerCapture(event.pointerId);
    card.classList.add("swipe-card--dragging");
  };

  const onPointerMove = (event) => {
    if (!dragging || swipeBusy) {
      return;
    }

    deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 12) {
      dragging = false;
      resetCard(true);
      card.releasePointerCapture(event.pointerId);
      card.classList.remove("swipe-card--dragging");
      return;
    }

    setTransform(deltaX, false);
  };

  const onPointerUp = (event) => {
    if (!dragging) {
      return;
    }

    dragging = false;
    card.releasePointerCapture(event.pointerId);
    card.classList.remove("swipe-card--dragging");

    if (deltaX > SWIPE_THRESHOLD) {
      commitSwipe("right", listing, settings, card);
    } else if (deltaX < -SWIPE_THRESHOLD) {
      commitSwipe("left", listing, settings, card);
    } else {
      resetCard(true);
    }
  };

  card.addEventListener("pointerdown", onPointerDown);
  card.addEventListener("pointermove", onPointerMove);
  card.addEventListener("pointerup", onPointerUp);
  card.addEventListener("pointercancel", onPointerUp);

  card.addEventListener("dblclick", (event) => {
    event.preventDefault();
    openListingDetail(listing, settings.anchorLabel, settings.anchor);
  });
}

function wireSwipeActionButtons(listing, settings) {
  swipePassBtn.onclick = () => commitSwipe("left", listing, settings);
  swipeLikeBtn.onclick = () => commitSwipe("right", listing, settings);
  swipeInfoBtn.onclick = () => openListingDetail(listing, settings.anchorLabel, settings.anchor);
}

async function commitSwipe(direction, listing, settings, cardEl = null) {
  if (swipeBusy) {
    return;
  }

  swipeBusy = true;
  const card = cardEl || swipeStack.querySelector(".swipe-card--top");
  const flyX = direction === "right" ? window.innerWidth * SWIPE_OFF_RATIO : -window.innerWidth * SWIPE_OFF_RATIO;
  const flyRotate = direction === "right" ? 22 : -22;

  if (card) {
    card.classList.add("swipe-card--dragging");
    card.style.transition = "transform 0.34s ease-out, opacity 0.34s ease-out";
    card.style.transform = `translateX(${flyX}px) rotate(${flyRotate}deg)`;
    card.style.opacity = "0";

    const nopeStamp = card.querySelector(".swipe-stamp--nope");
    const likeStamp = card.querySelector(".swipe-stamp--like");
    if (direction === "right") {
      likeStamp.style.opacity = "1";
    } else {
      nopeStamp.style.opacity = "1";
    }
  }

  if (direction === "right") {
    const voted = await voteForListing(listing.id);
    if (!voted) {
      swipeBusy = false;
      if (card) {
        card.classList.remove("swipe-card--dragging");
        card.style.transition = "transform 0.28s ease";
        card.style.transform = "";
        card.style.opacity = "";
      }
      return;
    }
    setTravelStatus(`You voted for ${listing.title}!`);
  }

  addPassedId(listing.id);

  const settingsAfter = getViewSettings();
  if (!getSwipeDeck(settingsAfter).length && listings.length) {
    setTravelStatus("You're done swiping — compare all stays below.");
  }

  window.setTimeout(() => {
    swipeBusy = false;
    render();
  }, 320);
}

function renderLeaderboard(settings) {
  const ranked = sortListings(listings, { ...settings, sortBy: "votes" }).filter(
    (listing) => getVoteCount(listing.id) > 0,
  );

  leaderboardList.replaceChildren();

  if (!ranked.length) {
    homeLeaderboard.hidden = true;
    return;
  }

  homeLeaderboard.hidden = false;
  ranked.forEach((listing, index) => {
    const item = document.createElement("li");
    item.className = "leaderboard-item";
    if (getLeadingListingId() === listing.id) {
      item.classList.add("leaderboard-item--leading");
    }

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = String(index + 1);

    const title = document.createElement("span");
    title.className = "leaderboard-name";
    title.textContent = listing.title;

    const votes = document.createElement("span");
    votes.className = "leaderboard-votes";
    const count = getVoteCount(listing.id);
    votes.textContent = `${count} ${count === 1 ? "vote" : "votes"}`;

    const voters = document.createElement("span");
    voters.className = "leaderboard-voters";
    const names = formatVoterNames(listing.id);
    if (names) {
      voters.textContent = names;
    }

    item.append(rank, title, votes);
    if (names) {
      item.append(voters);
    }
    leaderboardList.append(item);
  });
}

// Resolves one remote listing-photo URL to its cached local file, using the
// URL-keyed map from the latest /api/cache-images call. Falls back to the old
// positional localImages array for listings cached before that map existed.
function resolvePhotoSrc(listing, remoteUrl, indexInImages) {
  const local = listing.localImageMap?.[remoteUrl];
  if (local) {
    return local;
  }

  return listing.localImages?.[indexInImages] || remoteUrl;
}

function getListingPhotoList(listing) {
  const seen = new Set();
  const photos = [];

  const add = (src) => {
    if (src && !seen.has(src)) {
      seen.add(src);
      photos.push(src);
    }
  };

  (listing.images || []).forEach((url, index) => add(resolvePhotoSrc(listing, url, index)));
  add(listing.image);
  (listing.localImages || []).forEach(add);

  return photos;
}

function getListingPhotoGroups(listing) {
  if (!listing.photoRooms?.some((group) => group.room)) {
    return null;
  }

  const groups = listing.photoRooms
    .map((group) => ({
      room: group.room,
      photos: (group.images || [])
        .map((url) => resolvePhotoSrc(listing, url, (listing.images || []).indexOf(url)))
        .filter(Boolean),
    }))
    .filter((group) => group.photos.length);

  return groups.length ? groups : null;
}

function getListingImage(listing) {
  return getListingPhotoList(listing)[0] || "";
}

function fillListingPhoto(photo, photoEmpty, listing, onNoPhoto) {
  const sources = getListingPhotoList(listing);

  if (!sources.length) {
    photo.remove();
    if (photoEmpty) {
      photoEmpty.hidden = false;
    }
    onNoPhoto?.();
    return;
  }

  let index = 0;
  if (photoEmpty) {
    photoEmpty.hidden = true;
  }

  const showEmpty = () => {
    photo.remove();
    if (photoEmpty) {
      photoEmpty.hidden = false;
    }
    onNoPhoto?.();
  };

  const trySource = () => {
    if (index >= sources.length) {
      showEmpty();
      return;
    }

    photo.src = sources[index];
    index += 1;
  };

  photo.onerror = trySource;
  trySource();
}

// With no roomKey (or when that room can't be found), returns every photo in
// listing order — the flat fallback used whenever a listing has no room data.
function getListingPhotos(listing, roomKey) {
  if (roomKey) {
    const match = getListingPhotoGroups(listing)?.find((group) => group.room === roomKey);
    if (match) {
      return match.photos;
    }
  }

  return getListingPhotoList(listing);
}

function populateListingDetailFacts(container, listing) {
  container.replaceChildren();
  const factItems = [
    listing.rating != null && `★ ${listing.rating.toFixed(1)}`,
    listing.bedrooms != null && `${listing.bedrooms} bd`,
    listing.guests != null && `${listing.guests} guests`,
    listing.beds != null && `${listing.beds} beds`,
    listing.baths != null && `${listing.baths} baths`,
  ].filter(Boolean);

  factItems.forEach((text) => {
    const fact = document.createElement("span");
    fact.className = "fact";
    fact.textContent = text;
    container.append(fact);
  });
}

function populateListingDetailAmenities(container, listing) {
  container.replaceChildren();
  if (!listing.amenities?.length) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  listing.amenities.forEach((amenity) => {
    const tag = document.createElement("span");
    tag.textContent = amenity;
    container.append(tag);
  });
}

const UNCATEGORIZED_ROOM_KEY = "__uncategorized__";

// Looks up the caption Airbnb showed for this specific photo in the photo tour,
// by matching the resolved (possibly locally-cached) src back to its remote URL.
function getPhotoCaption(listing, src) {
  if (!src || !listing.photoRooms?.length) {
    return "";
  }

  const index = (listing.images || []).findIndex(
    (url, i) => resolvePhotoSrc(listing, url, i) === src,
  );
  const remoteUrl = index >= 0 ? listing.images[index] : src;

  for (const group of listing.photoRooms) {
    if (group.captions?.[remoteUrl]) {
      return group.captions[remoteUrl];
    }
  }

  return "";
}

function setGalleryRoomFilter(roomKey) {
  if (!detailContext) {
    return;
  }

  detailContext.roomFilter = roomKey;
  detailContext.photoIndex = 0;
  updateDetailGallery();
}

function renderGalleryRoomChips() {
  if (!detailFields.galleryRooms) {
    return;
  }

  const groups = getListingPhotoGroups(detailContext.listing);
  detailFields.galleryRooms.replaceChildren();

  if (!groups) {
    detailFields.galleryRooms.hidden = true;
    return;
  }

  detailFields.galleryRooms.hidden = false;

  const makeChip = (label, key, count) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "gallery-room-chip";
    chip.classList.toggle("gallery-room-chip--active", (detailContext.roomFilter || null) === key);
    chip.textContent = `${label} (${count})`;
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      setGalleryRoomFilter(key);
    });
    detailFields.galleryRooms.append(chip);
  };

  makeChip("All", null, getListingPhotoList(detailContext.listing).length);
  groups.forEach((group) => {
    makeChip(group.room || "Other photos", group.room ?? UNCATEGORIZED_ROOM_KEY, group.photos.length);
  });
}

function updateDetailGallery() {
  if (!detailContext) {
    return;
  }

  renderGalleryRoomChips();

  const photos = getListingPhotos(detailContext.listing, detailContext.roomFilter);
  const hasPhotos = photos.length > 0;
  const index = photos.length ? Math.min(detailContext.photoIndex, photos.length - 1) : 0;
  detailContext.photoIndex = index;

  detailFields.galleryImage.hidden = !hasPhotos;
  detailFields.galleryEmpty.hidden = hasPhotos;
  detailFields.galleryFullscreen.hidden = !hasPhotos;
  detailFields.galleryPrev.hidden = photos.length <= 1;
  detailFields.galleryNext.hidden = photos.length <= 1;
  detailFields.galleryCounter.hidden = photos.length <= 1;

  if (hasPhotos) {
    detailFields.galleryImage.src = photos[index];
    detailFields.galleryImage.alt = `${detailContext.listing.title} photo ${index + 1}`;
    detailFields.galleryCounter.textContent = `${index + 1} / ${photos.length}`;

    const caption = getPhotoCaption(detailContext.listing, photos[index]);
    if (detailFields.galleryCaption) {
      detailFields.galleryCaption.textContent = caption;
      detailFields.galleryCaption.hidden = !caption;
    }
  } else {
    detailFields.galleryImage.removeAttribute("src");
    if (detailFields.galleryCaption) {
      detailFields.galleryCaption.hidden = true;
    }
  }

  if (lightboxOpen) {
    updateLightbox();
  }
}

function shiftDetailPhoto(delta) {
  if (!detailContext) {
    return;
  }

  const photos = getListingPhotos(detailContext.listing, detailContext.roomFilter);
  if (photos.length <= 1) {
    return;
  }

  detailContext.photoIndex =
    (detailContext.photoIndex + delta + photos.length) % photos.length;
  updateDetailGallery();
}

function updateLightbox() {
  if (!detailContext) {
    return;
  }

  const photos = getListingPhotos(detailContext.listing, detailContext.roomFilter);
  if (!photos.length) {
    return;
  }

  const index = detailContext.photoIndex;
  lightboxFields.image.src = photos[index];
  lightboxFields.image.alt = `${detailContext.listing.title} photo ${index + 1}`;
  lightboxFields.prev.hidden = photos.length <= 1;
  lightboxFields.next.hidden = photos.length <= 1;
  lightboxFields.counter.hidden = photos.length <= 1;
  lightboxFields.counter.textContent = `${index + 1} / ${photos.length}`;
}

function openLightbox() {
  if (!detailContext) {
    return;
  }

  const photos = getListingPhotos(detailContext.listing, detailContext.roomFilter);
  if (!photos.length) {
    return;
  }

  lightboxOpen = true;
  updateLightbox();
  photoLightbox.hidden = false;
}

function closeLightbox() {
  lightboxOpen = false;
  photoLightbox.hidden = true;
  lightboxFields.image.removeAttribute("src");
}

function populateListingDetail() {
  if (!detailContext) {
    return;
  }

  const { listing, anchorId } = detailContext;
  const travelMinutes = listing.times[anchorId];

  detailFields.driveTime.textContent = formatTravelDuration(travelMinutes);
  applyPriceBadge(
    {
      priceEl: detailFields.price,
      unitEl: detailFields.priceUnit,
      breakdownEl: detailFields.priceBreakdown,
    },
    listing,
  );
  setupPriceToggle(detailFields.priceBadge, listing);

  detailFields.title.textContent = listing.title;
  detailFields.area.textContent = listing.area || "Location pending";
  populateListingDetailFacts(detailFields.facts, listing);
  populateListingDetailAmenities(detailFields.amenities, listing);
  detailFields.link.href = listing.url || "#";
  applyVoteButton(detailFields.voteButton, listing);
  if (detailFields.remove) {
    detailFields.remove.hidden = !allowRemoveListings;
  }

  const voterNames = formatVoterNames(listing.id);
  if (voterNames) {
    detailFields.voteVoters.textContent = `${voterNames} voted`;
    detailFields.voteVoters.hidden = false;
  } else {
    detailFields.voteVoters.textContent = "";
    detailFields.voteVoters.hidden = true;
  }

  updateDetailGallery();
}

function openListingDetail(listing, anchorLabel, anchorId, photoIndex = 0) {
  const photos = getListingPhotos(listing);
  detailContext = {
    listing,
    anchorLabel,
    anchorId,
    roomFilter: null,
    photoIndex: photos.length ? Math.min(photoIndex, photos.length - 1) : 0,
  };

  populateListingDetail();
  listingDetailOverlay.hidden = false;
  document.body.classList.add("listing-detail-open");
  detailFields.panel?.focus();
}

function closeListingDetail() {
  closeLightbox();
  listingDetailOverlay.hidden = true;
  document.body.classList.remove("listing-detail-open");
  detailContext = null;
}

function setupListingDetailOverlay() {
  if (!listingDetailOverlay) {
    return;
  }

  detailFields.panel.tabIndex = -1;

  listingDetailOverlay.querySelectorAll("[data-close-detail]").forEach((element) => {
    element.addEventListener("click", closeListingDetail);
  });

  detailFields.galleryPrev.addEventListener("click", (event) => {
    event.stopPropagation();
    shiftDetailPhoto(-1);
  });

  detailFields.galleryNext.addEventListener("click", (event) => {
    event.stopPropagation();
    shiftDetailPhoto(1);
  });

  detailFields.galleryFullscreen.addEventListener("click", (event) => {
    event.stopPropagation();
    openLightbox();
  });

  detailFields.galleryImage.addEventListener("click", (event) => {
    event.stopPropagation();
    openLightbox();
  });

  setupLightbox();

  detailFields.voteButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (detailContext) {
      toggleVote(detailContext.listing.id);
    }
  });

  detailFields.remove?.addEventListener("click", async () => {
    if (!detailContext || !allowRemoveListings) {
      return;
    }

    const listingId = detailContext.listing.id;
    closeListingDetail();
    listings = listings.filter((item) => item.id !== listingId);
    saveListings();
    await refreshVotes();
    render();
  });

  document.addEventListener("keydown", (event) => {
    if (listingDetailOverlay.hidden) {
      return;
    }

    if (event.key === "Escape") {
      if (lightboxOpen) {
        closeLightbox();
      } else {
        closeListingDetail();
      }
    } else if (event.key === "ArrowLeft") {
      shiftDetailPhoto(-1);
    } else if (event.key === "ArrowRight") {
      shiftDetailPhoto(1);
    }
  });

  let touchStartX = null;
  detailFields.galleryStage.addEventListener(
    "touchstart",
    (event) => {
      touchStartX = event.changedTouches[0].clientX;
    },
    { passive: true },
  );

  detailFields.galleryStage.addEventListener(
    "touchend",
    (event) => {
      if (touchStartX == null) {
        return;
      }

      const delta = event.changedTouches[0].clientX - touchStartX;
      touchStartX = null;

      if (Math.abs(delta) < 40) {
        return;
      }

      shiftDetailPhoto(delta > 0 ? -1 : 1);
    },
    { passive: true },
  );
}

function setupLightbox() {
  if (!photoLightbox) {
    return;
  }

  photoLightbox.querySelectorAll("[data-close-lightbox]").forEach((element) => {
    element.addEventListener("click", closeLightbox);
  });

  lightboxFields.prev.addEventListener("click", (event) => {
    event.stopPropagation();
    shiftDetailPhoto(-1);
  });

  lightboxFields.next.addEventListener("click", (event) => {
    event.stopPropagation();
    shiftDetailPhoto(1);
  });

  let touchStartX = null;
  lightboxFields.stage.addEventListener(
    "touchstart",
    (event) => {
      touchStartX = event.changedTouches[0].clientX;
    },
    { passive: true },
  );

  lightboxFields.stage.addEventListener(
    "touchend",
    (event) => {
      if (touchStartX == null) {
        return;
      }

      const delta = event.changedTouches[0].clientX - touchStartX;
      touchStartX = null;

      if (Math.abs(delta) < 40) {
        return;
      }

      shiftDetailPhoto(delta > 0 ? -1 : 1);
    },
    { passive: true },
  );
}

async function cacheImagesForListing(listing) {
  if (!listing.images?.length) {
    return listing;
  }

  try {
    const response = await fetch("/api/cache-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId: listing.id,
        urls: listing.images,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Could not cache images.");
    }

    listing.localImages = data.localImages || [];
    listing.localImageMap = data.map || {};
    listing.image = listing.localImageMap[listing.images[0]] || listing.localImages[0] || listing.images[0];
    saveListings();
  } catch {
    listing.image = listing.images[0];
  }

  return listing;
}

function createListingCard(listing, anchorLabel, anchorId) {
  const card = listingCardTemplate.content.firstElementChild.cloneNode(true);
  const travelMinutes = listing.times[anchorId];
  const photoEl = card.querySelector(".stay-photo");
  const photoWrap = card.querySelector(".stay-photo-wrap");
  const photoCount = card.querySelector(".photo-count");

  fillListingPhoto(photoEl, null, listing, () => {
    photoWrap.classList.add("stay-photo-wrap--empty");
    photoCount.hidden = true;
  });

  if (photoEl.isConnected) {
    photoEl.alt = listing.title;
    const totalPhotos = getListingPhotoList(listing).length;
    if (totalPhotos > 1) {
      photoCount.textContent = `+${totalPhotos - 1} photos`;
    } else {
      photoCount.hidden = true;
    }
  }

  card.querySelector(".drive-time").textContent = formatTravelDuration(travelMinutes);
  const priceBadge = card.querySelector(".price-badge");
  applyPriceBadge(
    {
      priceEl: priceBadge.querySelector(".price"),
      unitEl: priceBadge.querySelector(".price-unit"),
      breakdownEl: priceBadge.querySelector(".price-breakdown"),
    },
    listing,
  );
  setupPriceToggle(priceBadge, listing);
  card.querySelector(".stay-title").textContent = listing.title;
  card.querySelector(".stay-area").textContent = listing.area || "Location pending";

  const facts = card.querySelector(".stay-facts");
  const factItems = [
    listing.rating != null && `★ ${listing.rating.toFixed(1)}`,
    listing.bedrooms != null && `${listing.bedrooms} bd`,
    listing.guests != null && `${listing.guests} guests`,
    listing.beds != null && `${listing.beds} beds`,
    listing.baths != null && `${listing.baths} baths`,
  ].filter(Boolean);

  factItems.forEach((text) => {
    const fact = document.createElement("span");
    fact.className = "fact";
    fact.textContent = text;
    facts.append(fact);
  });

  const amenities = card.querySelector(".amenities");
  if (listing.amenities?.length) {
    listing.amenities.forEach((amenity) => {
      const tag = document.createElement("span");
      tag.textContent = amenity;
      amenities.append(tag);
    });
  } else {
    amenities.hidden = true;
  }

  const link = card.querySelector(".listing-link");
  link.href = listing.url || "#";

  const voteButton = card.querySelector(".vote-button");
  applyVoteButton(voteButton, listing);
  voteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleVote(listing.id);
  });

  if (getLeadingListingId() === listing.id) {
    card.classList.add("stay-card--leading");
  }

  card.classList.add("stay-card--clickable");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `View details for ${listing.title}`);

  const openDetail = () => openListingDetail(listing, anchorLabel, anchorId);

  card.addEventListener("click", (event) => {
    if (event.target.closest("a, button, .vote-button")) {
      return;
    }
    openDetail();
  });

  card.addEventListener("keydown", (event) => {
    if (event.target.closest("a, button, .vote-button")) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail();
    }
  });

  const removeButton = card.querySelector(".remove-button");
  if (allowRemoveListings) {
    removeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      listings = listings.filter((item) => item.id !== listing.id);
      saveListings();
      await refreshVotes();
      render();
    });
  } else {
    removeButton.hidden = true;
  }

  return card;
}

function updateBoard(settings) {
  const totalVotes = Object.values(voteData.counts).reduce((sum, count) => sum + count, 0);
  const voteNote = totalVotes ? ` · ${totalVotes} ${totalVotes === 1 ? "vote" : "votes"}` : "";
  fields.listingCount.textContent = `${listings.length} ${listings.length === 1 ? "stay" : "stays"}${voteNote}`;

  if (swipeAgainBtn) {
    swipeAgainBtn.hidden = !listings.length;
  }

  if (resetVotingBtn) {
    resetVotingBtn.hidden = !listings.length;
  }

  const primary = getAnchorById(settings.anchor) || DEFAULT_NYC_ANCHOR;
  fields.homeBaseSummary.textContent = `${primary.label} · ${primary.address}`;
}

fields.sortBy.addEventListener("change", render);
fields.travelMode.addEventListener("change", saveMapsSettings);
fields.voterNameInput?.addEventListener("change", () => saveVoterName(fields.voterNameInput.value));
fields.voterNameInput?.addEventListener("blur", () => saveVoterName(fields.voterNameInput.value));
swipeAgainBtn?.addEventListener("click", resetVoting);
resetVotingBtn?.addEventListener("click", resetVoting);
settingsResetVotingBtn?.addEventListener("click", resetVoting);

function createListingFromImport(imported) {
  const destination = (imported.location || imported.area || "").trim();

  return {
    id: makeId(),
    title: imported.title || "Imported stay",
    url: imported.url || "",
    area: destination,
    location: destination,
    price: imported.price ?? 300,
    priceNights: imported.priceNights,
    priceTotal: imported.priceTotal,
    guests: imported.guests ?? 4,
    bedrooms: imported.bedrooms ?? 2,
    beds: imported.beds ?? 2,
    baths: imported.baths ?? 1,
    rating: imported.rating ?? 4.5,
    amenities: imported.amenities ?? [],
    images: imported.images || [],
    image: imported.images?.[0] || "",
    localImages: imported.localImages || [],
    photoRooms: imported.rooms || [],
    times: buildDefaultTimes(imported.times),
  };
}

function showImportNotice(listing) {
  let notice = document.querySelector("#importNotice");

  if (!notice) {
    notice = document.createElement("div");
    notice.id = "importNotice";
    notice.className = "import-notice";
    document.querySelector(".top-bar")?.append(notice);
  }

  notice.textContent = `Added "${listing.title}" — calculating drive time from your home base...`;
  notice.hidden = false;
}

function normalizeListingUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return String(url || "").split("?")[0].replace(/\/$/, "");
  }
}

function findListingByUrl(url) {
  const normalized = normalizeListingUrl(url);
  return listings.find((listing) => normalizeListingUrl(listing.url) === normalized);
}

function showPhotoMergeNotice(listing, addedCount) {
  let notice = document.querySelector("#importNotice");

  if (!notice) {
    notice = document.createElement("div");
    notice.id = "importNotice";
    notice.className = "import-notice";
    document.querySelector(".top-bar")?.append(notice);
  }

  notice.textContent = `Added ${addedCount} photos to "${listing.title}" — caching images...`;
  notice.hidden = false;
}

// Merges same-named room buckets together and unions their photos, so re-running
// the photo tour scraper (or scraping again after Airbnb reorders things) doesn't
// duplicate or drop room groupings already saved on the listing.
function mergePhotoRooms(existingRooms, newRooms) {
  const merged = new Map();

  (existingRooms || []).forEach((group) => {
    merged.set(group.room ?? null, {
      room: group.room ?? null,
      images: [...(group.images || [])],
      captions: { ...(group.captions || {}) },
    });
  });

  (newRooms || []).forEach((group) => {
    const key = group.room ?? null;
    const bucket = merged.get(key) || { room: key, images: [], captions: {} };
    const seen = new Set(bucket.images);

    (group.images || []).forEach((url) => {
      if (!seen.has(url)) {
        seen.add(url);
        bucket.images.push(url);
      }
    });

    Object.assign(bucket.captions, group.captions || {});
    merged.set(key, bucket);
  });

  return [...merged.values()];
}

async function mergePhotosIntoListing(existing, newImages, newRooms) {
  const previousCount = existing.images?.length || 0;
  const merged = [...new Set([...(existing.images || []), ...(newImages || [])])];
  const addedCount = merged.length - previousCount;

  existing.images = merged;
  existing.image = merged[0] || existing.image;
  existing.photoRooms = mergePhotoRooms(existing.photoRooms, newRooms);
  saveListings();
  showPhotoMergeNotice(existing, addedCount);
  render();

  if (merged.length) {
    const updated = await cacheImagesForListing(existing);
    Object.assign(existing, updated);
    render();
  }

  const notice = document.querySelector("#importNotice");
  if (notice) {
    notice.hidden = true;
  }

  setTravelStatus(`Added ${addedCount || merged.length} photos to ${existing.title}.`);
  return existing;
}

async function importListing(imported) {
  if (imported.photosOnly && imported.url) {
    const existing = findListingByUrl(imported.url);
    if (!existing) {
      setTravelStatus("No matching listing found — use Extract & Send first.", true);
      return;
    }

    if (!imported.images?.length) {
      setTravelStatus("No photos were found in the photo tour.", true);
      return;
    }

    await mergePhotosIntoListing(existing, imported.images, imported.rooms);
    return;
  }

  let listing = createListingFromImport(imported);
  listings = [listing, ...listings];
  saveListings();
  showImportNotice(listing);
  render();

  if (listing.images?.length) {
    listing = await cacheImagesForListing(listing);
    render();
  }

  if (getListingDestination(listing) && getConfiguredAnchors().length) {
    try {
      const result = await updateListingTravelTimes(listing.id);
      render();
      const notice = document.querySelector("#importNotice");
      if (notice) {
        notice.hidden = true;
      }
      setTravelStatus(
        `Added ${listing.title} · ${formatTravelDuration(listing.times[getViewSettings().anchor])} from home`,
      );
    } catch (error) {
      setTravelStatus(`Added ${listing.title}, but drive time failed: ${error.message}`, true);
    }
  } else if (!getConfiguredAnchors().length) {
    setTravelStatus("Add a home base to calculate drive times.", true);
  }
}

window.stayScoutImportListing = importListing;

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "ADD_LISTING") {
    importListing(event.data.listing);
  }
});

function readLegacyListings() {
  const stored = localStorage.getItem(storageKey);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map(hydrateListing) : [];
  } catch {
    return [];
  }
}

function readLegacyMapsSettings() {
  try {
    return JSON.parse(localStorage.getItem(mapsSettingsKey) || "{}");
  } catch {
    return {};
  }
}

async function migrateFromLocalStorage() {
  anchors = loadAnchors();
  selectedAnchorId = localStorage.getItem(selectedAnchorKey) || "";
  mapsSettings = readLegacyMapsSettings();
  listings = readLegacyListings();

  const hasLegacyData =
    anchors.length ||
    listings.length ||
    selectedAnchorId ||
    Object.keys(mapsSettings).length;

  if (!hasLegacyData) {
    return;
  }

  try {
    await Promise.all([
      fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchors,
          selectedAnchor: selectedAnchorId,
          mapsSettings: { travelMode: mapsSettings.travelMode },
        }),
      }),
      fetch("/api/listings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listings }),
      }),
    ]);

    [storageKey, anchorsStorageKey, selectedAnchorKey, mapsSettingsKey].forEach((key) =>
      localStorage.removeItem(key),
    );
    console.info("StayScout: migrated existing local data into SQLite.");
  } catch (error) {
    console.error("StayScout: could not migrate local data into SQLite.", error);
  }
}

async function init() {
  setupListingDetailOverlay();
  setupSettingsOverlay();
  setupFullscreenPrompt();
  setupOnboarding();
  voterId = getVoterId();

  if (fields.voterNameInput) {
    fields.voterNameInput.value = localStorage.getItem(voterNameKey) || "";
  }

  let state = null;
  try {
    state = await api.getState();
  } catch (error) {
    console.error("StayScout: could not load saved data.", error);
  }

  const hasServerData =
    state &&
    ((state.listings && state.listings.length) ||
      (state.anchors && state.anchors.length) ||
      state.selectedAnchor ||
      (state.mapsSettings && Object.keys(state.mapsSettings).length));

  if (hasServerData) {
    anchors = (state.anchors || []).map(normalizeAnchor).filter((anchor) => anchor.address);
    selectedAnchorId = state.selectedAnchor || "";
    mapsSettings = state.mapsSettings || {};
    listings = (state.listings || []).map(hydrateListing);
    voteData = state.votes || { counts: {}, byListing: {} };
  } else {
    await migrateFromLocalStorage();
  }

  ensureDefaultAnchor();

  const hadStoredKey = Boolean(mapsSettings && mapsSettings.googleApiKey);

  await loadServerConfig();
  applyMapsSettings();
  renderAnchorSelect();
  renderAnchorList();
  hydrating = false;

  if (hadStoredKey) {
    delete mapsSettings.googleApiKey;
    saveMapsSettings();
  }

  if (!hydrating && anchors.length) {
    persistSettings();
  }

  render();

  document.addEventListener("keydown", (event) => {
    if (settingsOverlay && !settingsOverlay.hidden) {
      return;
    }
    if (listingDetailOverlay && !listingDetailOverlay.hidden) {
      return;
    }
    if (!activeSwipeListing || !activeSwipeSettings || swipeBusy) {
      return;
    }
    if (event.target.closest("input, textarea, select")) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      commitSwipe("left", activeSwipeListing, activeSwipeSettings);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      commitSwipe("right", activeSwipeListing, activeSwipeSettings);
    }
  });
}

init();

const DATA_URL = "dict_idioms_2020_20260324.min.json";
const MAX_RESULTS = 40;
const FAVORITES_KEY = "dict-idioms-favorites";
const DEFAULT_FAVORITES_TITLE = "我的收藏";
const DEFAULT_FAVORITE_COLLECTION_ID = "my-favorites";
const FAVORITES_EXPORT_SCHEMA = "dict-idioms-favorites@1";
const FAVORITE_DRAG_THRESHOLD = 6;
const FAVORITE_LONG_PRESS_DELAY = 420;
const PRONUNCIATION_MODE_KEY = "dict-idioms-pronunciation-mode";
const DEFAULT_OPEN_COUNT = 6;
const IME_COMPOSITION_TOLERANCE_MS = 300;
const QUICK_KEYWORDS = [
  "人心", "友情", "學習", "努力", "勇敢", "智慧",
  "成功", "失敗", "誠實", "謙虛", "驕傲", "勤奮",
  "懶惰", "危險", "平安", "困難", "機會", "改變",
  "言語", "行動", "速度", "時間", "才能", "方法",
  "家庭", "朋友", "敵人", "戰爭", "快樂", "悲傷"
];
const favoriteSettings = readFavoritesSettings();

const state = {
  idioms: [],
  idiomByName: new Map(),
  query: "",
  matchMode: "any",
  filter: "main",
  resultsMode: "main",
  currentPage: 1,
  openId: "",
  pronunciationMode: readPronunciationMode(),
  totalSearchResults: 0,
  dailyItem: null,
  visibleResults: [],
  favoriteCollections: favoriteSettings.collections,
  activeFavoriteCollectionId: favoriteSettings.activeCollectionId,
  favoritesTitle: favoriteSettings.title,
  favorites: new Set(favoriteSettings.favorites)
};

const els = {
  dataStatus: document.querySelector("#dataStatus"),
  dailyCard: document.querySelector(".memory-card"),
  dailyIdiom: document.querySelector("#dailyIdiom"),
  dailyPronunciation: document.querySelector("#dailyPronunciation"),
  dailyMeaning: document.querySelector("#dailyMeaning"),
  form: document.querySelector("#searchForm"),
  input: document.querySelector("#queryInput"),
  filters: document.querySelectorAll(".filter"),
  quickPicks: document.querySelectorAll(".quick-picks button"),
  results: document.querySelector("#results"),
  resultCount: document.querySelector("#resultCount"),
  template: document.querySelector("#idiomTemplate"),
  randomTop: document.querySelector("#randomTop"),
  favoritesTitle: document.querySelector("#favorites-title"),
  favoritesList: document.querySelector("#favoritesList"),
  favoriteCollectionsList: document.querySelector("#favoriteCollectionsList"),
  favoritesStatus: document.querySelector("#favoritesStatus"),
  shareFavorites: document.querySelector("#shareFavorites"),
  newFavoriteCollection: document.querySelector("#createFavoriteCollection"),
  duplicateFavoriteCollection: document.querySelector("#duplicateFavoriteCollection"),
  modal: document.querySelector("#idiomModal"),
  modalKind: document.querySelector("#idiomModalKind"),
  modalId: document.querySelector("#idiomModalId"),
  modalTitle: document.querySelector("#idiomModalTitle"),
  modalPronunciation: document.querySelector("#idiomModalPronunciation"),
  modalContent: document.querySelector("#idiomModalContent"),
  modalClose: document.querySelector("#idiomModalClose")
};

let favoriteTitleBeforeEdit = state.favoritesTitle;
let favoriteStatusTimer = 0;
let favoritePointerDrag = null;
let suppressFavoriteClick = false;
let isQueryInputComposing = false;
let lastQueryCompositionEnd = 0;
let favoriteTitleEditContext = null;
let favoriteLongPressTimer = 0;
const shareFeedbackTimers = new WeakMap();

init();

async function init() {
  applySearchFromUrl();
  syncFavoritesTitle();
  bindEvents();
  await registerServiceWorker();

  try {
    const payload = await loadData();
    if (!payload) throw new Error("資料載入失敗");

    state.idioms = Array.isArray(payload) ? payload : payload.idioms || [];
    state.idioms = state.idioms.map(prepareIdiom);
    state.idiomByName = new Map(state.idioms.map(item => [String(item.成語 || "").trim(), item]).filter(([name]) => name));
    const sharedImport = applyFavoritesFromFragment();
    const shouldShowSharedFavorites = Boolean(sharedImport);

    els.dataStatus.textContent = `已載入 ${state.idioms.length.toLocaleString("zh-TW")} 筆成語`;
    setDailyCard();
    setQuickPicks();
    renderFavorites();
    renderFavoriteCollections();

    const initialResult = state.query ? searchIdioms() : (shouldShowSharedFavorites ? favoriteItems() : pickOpeningSet());
    renderResults(
      initialResult,
      shouldShowSharedFavorites
        ? {
            label: `顯示 ${initialResult.length} 筆收藏`,
            mode: "favorites"
          }
        : {}
    );

    if (state.openId) {
      const target = findIdiomByIdentifier(state.openId);
      if (target) {
        openIdiomModal(target, false);
      }
    }
  } catch (error) {
    els.dataStatus.textContent = "資料載入失敗";
    els.results.innerHTML = `<p class="empty-state">無法讀取成語資料。請確認 ${DATA_URL} 是否存在。</p>`;
    console.error(error);
  }
}

function bindEvents() {
  els.form.addEventListener("submit", event => {
    event.preventDefault();
    state.query = normalize(els.input.value);
    state.currentPage = 1;
    renderResults(searchIdioms());
    updateLocationFromState();
    els.results.focus({ preventScroll: true });
  });

  els.input.addEventListener("input", () => {
    state.query = normalize(els.input.value);
    state.currentPage = 1;
    renderResults(searchIdioms());
    updateLocationFromState();
  });

  els.input.addEventListener("compositionstart", () => {
    isQueryInputComposing = true;
  });

  els.input.addEventListener("compositionend", () => {
    isQueryInputComposing = false;
    lastQueryCompositionEnd = Date.now();
  });

  els.filters.forEach(button => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      state.currentPage = 1;
      els.filters.forEach(item => item.classList.toggle("is-active", item === button));
      renderResults(searchIdioms());
      updateLocationFromState();
    });
  });

  els.quickPicks.forEach(button => {
    button.addEventListener("click", () => {
      els.input.value = button.dataset.query;
      state.query = normalize(button.dataset.query);
      state.currentPage = 1;
      renderResults(searchIdioms());
      updateLocationFromState();
      els.input.focus();
    });
  });

  els.results.addEventListener("click", handleResultsPaginationClick);

  els.randomTop.addEventListener("click", () => {
    const item = randomMainIdiom();
    if (!item) return;
    openIdiomModal(item, false);
  });

  els.dailyCard.addEventListener("click", () => {
    if (state.dailyItem) openIdiomModal(state.dailyItem);
  });

  els.dailyCard.addEventListener("keydown", event => {
    if (!state.dailyItem) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openIdiomModal(state.dailyItem);
    }
  });

  els.favoritesTitle.addEventListener("dblclick", startFavoriteTitleEdit);
  els.favoritesTitle.addEventListener("keydown", event => {
    if (isEditingFavoriteTitle()) {
      if (event.key === "Enter") {
        event.preventDefault();
        commitFavoriteTitleEdit();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        cancelFavoriteTitleEdit();
      }

      return;
    }

    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      startFavoriteTitleEdit();
    }
  });
  els.favoritesTitle.addEventListener("blur", () => {
    if (isEditingFavoriteTitle()) commitFavoriteTitleEdit();
  });

  els.shareFavorites.addEventListener("click", shareFavoritesLink);

  els.newFavoriteCollection?.addEventListener("click", () => {
    const collectionId = createFavoriteCollectionForEditing({
      title: DEFAULT_FAVORITES_TITLE,
      favorites: []
    }, {
      skipScrollToResults: true
    }, false);

    if (!collectionId) return;

    startFavoriteTitleEdit({
      clearTitleInput: true,
      isNewCollectionDraft: true,
      newCollectionId: collectionId,
      draftAction: "new",
      preserveScroll: true
    });
    setFavoritesStatus("已新增空白收藏清單");
  });

  els.duplicateFavoriteCollection?.addEventListener("click", () => {
    const activeCollection = getActiveFavoriteCollection();
    if (!activeCollection) return;

    const baseTitle = uniqueDuplicatedFavoriteCollectionTitle(activeCollection.title || DEFAULT_FAVORITES_TITLE);
    const collectionId = createFavoriteCollectionForEditing({
      title: baseTitle,
      favorites: [...activeCollection.favorites]
    }, {
      skipScrollToResults: true
    }, false);

    if (!collectionId) return;

    startFavoriteTitleEdit({
      isNewCollectionDraft: true,
      newCollectionId: collectionId,
      draftBaseTitle: baseTitle,
      draftAction: "duplicate",
      preserveScroll: true
    });
    setFavoritesStatus("已建立收藏清單複本");
  });

  els.modalClose.addEventListener("click", closeIdiomModal);
  els.modal.querySelector("[data-close-modal]").addEventListener("click", closeIdiomModal);
  document.addEventListener("keydown", handleGlobalKeyboardShortcuts);

  document.addEventListener("click", event => {
    const link = event.target.closest("[data-related-idiom]");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    openRelatedIdiom(link.dataset.relatedIdiom);
  });

  document.addEventListener("pointermove", handleFavoritePointerMove);
  document.addEventListener("pointerup", handleFavoritePointerUp);
  document.addEventListener("pointercancel", cancelFavoritePointerDrag);
  document.addEventListener("mousemove", handleFavoritePointerMove);
  document.addEventListener("mouseup", handleFavoritePointerUp);

  window.addEventListener("popstate", syncFromLocation);
}

function handleGlobalKeyboardShortcuts(event) {
  const isEscapeKey = event.key === "Escape" || event.key === "Esc" || event.keyCode === 27;

  if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !els.modal.classList.contains("is-hidden") && !isKeyboardTextTarget(event.target)) {
    event.preventDefault();
    openAdjacentVisibleResult(event.key === "ArrowRight" ? 1 : -1);
    return;
  }

  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isKeyboardTextTarget(event.target)) {
    event.preventDefault();
    els.input.focus();
    els.input.select();
    return;
  }

  if (!isEscapeKey) return;

  const inputFocused = document.activeElement === els.input;
  const composingInQueryInput = isQueryInputComposing || event.isComposing;
  const escapedRightAfterCompositionEnd = inputFocused && (Date.now() - lastQueryCompositionEnd <= IME_COMPOSITION_TOLERANCE_MS);
  const inputTarget = event.target === els.input;
  if ((composingInQueryInput || escapedRightAfterCompositionEnd) && (inputFocused || inputTarget)) {
    return;
  }

  if (!els.modal.classList.contains("is-hidden")) {
    closeIdiomModal();
    return;
  }

  if (isEditingFavoriteTitle()) return;
  if (!els.input.value && !state.query) return;

  event.preventDefault();
  const hadQuery = Boolean(els.input.value || state.query);
  els.input.value = "";
  state.query = "";
  state.currentPage = 1;
  renderResults(pickOpeningSet());
  const historyMode = hadQuery ? "push" : "replace";
  updateLocationFromState(undefined, false, historyMode);
}

function isKeyboardTextTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function openAdjacentVisibleResult(direction) {
  const results = state.visibleResults.filter(Boolean);
  if (results.length < 2) return;

  const currentIndex = results.findIndex(item => String(item.編號 || item.成語) === state.openId);
  const fallbackIndex = direction > 0 ? -1 : 0;
  const nextIndex = (currentIndex === -1 ? fallbackIndex : currentIndex) + direction;
  const wrappedIndex = (nextIndex + results.length) % results.length;
  openIdiomModal(results[wrappedIndex], true, "replace");
}

function setQuickPicks() {
  const keywordPicks = shuffle(QUICK_KEYWORDS).slice(0, Math.max(0, els.quickPicks.length - 1));
  const idiomPick = randomMainIdiom();
  const picks = [...keywordPicks, idiomPick?.成語].filter(Boolean).slice(0, els.quickPicks.length);

  els.quickPicks.forEach((button, index) => {
    const query = picks[index] || button.dataset.query || button.textContent.trim();
    button.dataset.query = query;
    button.textContent = query;
  });
}

function prepareIdiom(item) {
  const quiz = parseIdentificationQuiz(item["辨識-例句"]);

  const searchable = [
    item.成語,
    item.注音,
    item.漢語拼音,
    item.釋義,
    item.典故說明,
    item.書證,
    item["用法說明-語義說明"],
    item["用法說明-使用類別"],
    item["用法說明-例句"],
    item.近義成語,
    item.反義成語,
    item.參考詞語
  ].flat().filter(Boolean).join(" ");

  return {
    ...item,
    _search: normalize(searchable),
    _main: item["主條成語／非主條成語"] === "主條成語",
    _quiz: quiz
  };
}

function searchIdioms() {
  let items = state.idioms;

  if (state.filter === "main") items = items.filter(item => item._main);
  if (state.filter === "phrase") items = items.filter(item => item.參考詞語);
  if (state.filter === "story") items = items.filter(item => item.典故說明);
  if (state.filter === "quiz") items = items.filter(item => item._quiz);

  const queryPlan = parseQueryPlan(state.query, state.matchMode);

  if (!queryPlan.terms.length) {
    state.totalSearchResults = 0;
    state.currentPage = 1;
    return pickOpeningSet(items);
  }

  const sortedItems = items
    .map(item => ({ item, score: scoreItem(item, queryPlan) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.item.編號) - Number(b.item.編號))
    .map(entry => entry.item);

  state.totalSearchResults = sortedItems.length;
  state.currentPage = normalizeCurrentPage(state.currentPage, state.totalSearchResults);
  return sortedItems;
}

function getSearchTotalPages(total = state.totalSearchResults) {
  if (!total || total <= 0) return 1;
  return Math.ceil(total / MAX_RESULTS);
}

function normalizeCurrentPage(page, total = state.totalSearchResults) {
  const totalPages = getSearchTotalPages(total);
  const value = Number.parseInt(page, 10);

  if (!Number.isFinite(value) || value < 1) return 1;
  if (value > totalPages) return totalPages;
  return value;
}

function parseQueryPlan(query, matchMode = "any") {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) return { terms: [], matchAll: true };

  const mode = String(matchMode || "any").trim().toLowerCase();
  const splitTerms = normalizedQuery
    .split(/[,\uFF0C\s]+/)
    .map(term => normalize(term))
    .filter(Boolean);

  if (mode === "exact" || mode === "prefix" || mode === "suffix") {
    return {
      terms: splitTerms,
      termSet: new Set(splitTerms),
      matchAll: false,
      matchMode: mode
    };
  }

  return {
    terms: splitTerms,
    matchAll: false,
    matchMode: "any"
  };
}

function scoreItem(item, queryPlan) {
  const tokens = queryPlan.terms;
  if (queryPlan.matchMode === "exact" || queryPlan.matchMode === "prefix" || queryPlan.matchMode === "suffix") {
    const idiomText = normalize(item.成語);
    let match = false;

    for (const token of queryPlan.terms) {
      if (queryPlan.matchMode === "exact" && idiomText === token) match = true;
      if (queryPlan.matchMode === "prefix" && idiomText.startsWith(token)) match = true;
      if (queryPlan.matchMode === "suffix" && idiomText.endsWith(token)) match = true;
      if (match) break;
    }

    return match ? 1000 : 0;
  }

  const matchAll = queryPlan.matchAll;
  let score = 0;
  let matchedTerms = 0;
  let anyMatch = false;
  const idiomText = normalize(item.成語);
  const pinyinText = normalize(item.漢語拼音 || "");
  const zhuyinText = normalize(item.注音 || "");
  const meaningText = normalize(joinText(item.釋義));
  const usageText = normalize(joinText(item["用法說明-例句"]));
  const searchText = item._search || "";

  for (const token of tokens) {
    let tokenScore = 0;

    if (idiomText === token) tokenScore += 120;
    else if (idiomText.includes(token)) tokenScore += 80;

    if (pinyinText.includes(token)) tokenScore += 36;
    if (zhuyinText.includes(token)) tokenScore += 32;
    if (meaningText.includes(token)) tokenScore += 26;
    if (usageText.includes(token)) tokenScore += 18;

    if (tokenScore > 0 || searchText.includes(token)) {
      tokenScore += Math.max(1, 14 - Math.floor(searchText.indexOf(token) / 160));
      score += tokenScore;
      matchedTerms += 1;
      anyMatch = true;
    }
  }

  if (!anyMatch) return 0;
  if (matchAll && matchedTerms !== tokens.length) return 0;

  if (item._main) score += 8;
  return score;
}

function pickOpeningSet(items = state.idioms) {
  const list = items.filter(item => item._main).length
    ? items.filter(item => item._main)
    : items;
  const shuffled = shuffle(list);
  return shuffled.slice(0, Math.min(DEFAULT_OPEN_COUNT, shuffled.length));
}

function fallbackFavoriteResults() {
  const favorites = [];
  return pickOpeningSet(state.idioms)
    .filter(item => item && item.編號)
    .filter(item => {
      const key = String(item.編號);
      if (favorites.includes(key)) return false;
      favorites.push(key);
      return true;
    });
}

function renderResults(items, options = {}) {
  state.resultsMode = options.mode || (state.query ? "search" : "main");
  const isFavoritesMode = options.mode === "favorites";

  els.results.innerHTML = "";

  const isSearchMode = Boolean(state.query);
  const totalResults = isSearchMode ? state.totalSearchResults : items.length;

  if (!items.length) {
    if (isFavoritesMode) {
      const fallbackItems = fallbackFavoriteResults();

      if (fallbackItems.length) {
        const fragment = document.createDocumentFragment();
        fallbackItems.forEach((item, index) => {
          fragment.appendChild(createCard(item, index));
        });
        els.results.appendChild(fragment);
        state.visibleResults = [...fallbackItems];
        scrollToResultsTitle();
        return;
      }

      state.visibleResults = [];
    }

    if (isSearchMode) {
      els.resultCount.textContent = "找不到符合的成語";
      els.results.innerHTML = `<p class="empty-state">沒有找到符合條件的成語。可以改用更短的詞，例如「勇敢」、「朋友」或「吝嗇」。</p>`;
      return;
    }

    if (options.label) {
      els.resultCount.textContent = options.label;
      return;
    }

    els.resultCount.textContent = `先放上 ${items.length} 張推薦卡`;
    return;
  }

  let visibleItems = items;
  let start = 0;
  let end = items.length;

  if (isSearchMode) {
    const totalPages = getSearchTotalPages(totalResults);
    state.currentPage = normalizeCurrentPage(state.currentPage, totalResults);
    start = (state.currentPage - 1) * MAX_RESULTS;
    end = Math.min(start + MAX_RESULTS, totalResults);
    visibleItems = items.slice(start, end);
  }

  state.visibleResults = [...visibleItems];

  const fragment = document.createDocumentFragment();
  visibleItems.forEach((item, index) => fragment.appendChild(createCard(item, index)));
  els.results.appendChild(fragment);

  const label = options.label || (
    isSearchMode
      ? `顯示 ${start + 1} ~ ${Math.min(start + MAX_RESULTS, totalResults)} 筆結果，共 ${totalResults} 筆成語`
      : `先放上 ${items.length} 張推薦卡`
  );
  els.resultCount.textContent = label;

  if (isSearchMode) {
    const totalPages = getSearchTotalPages(totalResults);
    if (totalPages > 1) {
      els.results.appendChild(renderPagination(totalPages));
    }
  }
}

function renderPagination(totalPages) {
  if (totalPages <= 1) return document.createDocumentFragment();

  const nav = document.createElement("nav");
  nav.className = "results-pagination";
  nav.setAttribute("aria-label", "查詢結果分頁");

  const fragment = document.createDocumentFragment();

  const prevPage = Math.max(1, state.currentPage - 1);
  fragment.appendChild(createPaginationButton(prevPage, "上一頁", {
    isDisabled: state.currentPage <= 1,
    ariaLabel: "前往上一頁"
  }));

  const pages = [];
  const left = Math.max(1, state.currentPage - 2);
  const right = Math.min(totalPages, state.currentPage + 2);

  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || (page >= left && page <= right)) {
      pages.push(page);
    }
  }

  const uniquePages = [...new Set(pages)].sort((a, b) => a - b);

  let previousPage = 0;
  uniquePages.forEach((page) => {
    if (page > previousPage + 1) {
      fragment.appendChild(createPaginationSpacer());
    }
    fragment.appendChild(createPaginationButton(page, String(page), {
      isCurrent: page === state.currentPage,
      ariaLabel: `前往第 ${page} 頁`
    }));
    previousPage = page;
  });

  const nextPage = Math.min(totalPages, state.currentPage + 1);
  fragment.appendChild(createPaginationButton(nextPage, "下一頁", {
    isDisabled: state.currentPage >= totalPages,
    ariaLabel: "前往下一頁"
  }));

  nav.appendChild(fragment);
  return nav;
}

function createPaginationButton(page, text, options = {}) {
  if (options.isCurrent) {
    const span = document.createElement("span");
    span.className = "results-pagination__item results-pagination__item--current";
    span.textContent = text;
    span.setAttribute("aria-current", "page");
    return span;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "results-pagination__item";
  button.dataset.page = String(page);
  button.textContent = text;

  if (options.isDisabled) {
    button.disabled = true;
  }

  if (options.ariaLabel) {
    button.setAttribute("aria-label", options.ariaLabel);
  }

  return button;
}

function createPaginationSpacer() {
  const span = document.createElement("span");
  span.className = "results-pagination__item results-pagination__item--ellipsis";
  span.textContent = "…";
  return span;
}

function handleResultsPaginationClick(event) {
  const button = event.target.closest(".results-pagination__item[data-page]");
  if (!button) return;

  event.preventDefault();

  const nextPage = Number.parseInt(button.dataset.page, 10);
  if (!Number.isFinite(nextPage) || nextPage === state.currentPage) return;

  state.currentPage = normalizeCurrentPage(nextPage, state.totalSearchResults);
  renderResults(searchIdioms());
  updateLocationFromState();
  scrollToResultsTitle();
}

function scrollToResultsTitle() {
  requestAnimationFrame(() => {
    const resultsTitle = document.querySelector("#results-title");
    if (!resultsTitle) return;
    const offsetTop = Math.max(0, resultsTitle.getBoundingClientRect().top + window.scrollY - 50);
    window.scrollTo({ top: offsetTop, behavior: "smooth" });
  });
}

function scrollToFavoritesTitle() {
  requestAnimationFrame(() => {
    const favoritesTitle = document.querySelector("#favorites-title");
    if (!favoritesTitle) return;
    const offsetTop = Math.max(0, favoritesTitle.getBoundingClientRect().top + window.scrollY - 50);
    window.scrollTo({ top: offsetTop, behavior: "smooth" });
  });
}

function createCard(item, index) {
  const card = els.template.content.firstElementChild.cloneNode(true);
  card.style.animationDelay = `${Math.min(index * 35, 420)}ms`;
  card.querySelector(".idiom-card__number").textContent = `編號 ${item.編號 || "未載明"}`;
  card.querySelector("h3").textContent = item.成語 || "未命名成語";
  setupPronunciationToggle(card.querySelector(".pronunciation"), item, { primaryOnly: true });
  card.querySelector(".meaning").innerHTML = renderLinkedText(firstMeaning(item.釋義) || "此條目未提供釋義。");

  const favoriteButton = card.querySelector(".favorite-button");
  const key = String(item.編號 || item.成語);
  favoriteButton.classList.toggle("is-saved", state.favorites.has(key));
  favoriteButton.textContent = state.favorites.has(key) ? "已收藏" : "收藏";
  favoriteButton.addEventListener("click", event => {
    event.stopPropagation();
    toggleFavorite(item);
  });

  card.addEventListener("click", event => {
    if (event.target.closest("button")) return;
    openIdiomModal(item);
  });

  card.setAttribute("tabindex", "0");
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `開啟 ${item.成語} 詳細內容`);

  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openIdiomModal(item);
    }
  });

  renderTags(card.querySelector(".tags"), item);
  return card;
}

function renderTags(container, item) {
  container.innerHTML = "";
}

function renderDetails(container, item) {
  const blocks = [
    usageContextBlock(item["用法說明-使用類別"]),
    meaningBlock(item["用法說明-語義說明"]),
    listBlock("用法例句", item["用法說明-例句"], 4, item.成語),
    block("典故說明", item.典故說明),
    listBlock("書證", item.書證, 3),
    sourceBlock(item),
    identificationBlock(item),
    idiomListBlock("參考詞語", item.參考詞語)
  ].filter(Boolean);

  container.innerHTML = blocks.join("") || `<p class="empty-state">此條目沒有更多補充內容。</p>`;
}

function block(title, value) {
  const text = cleanText(joinText(value));
  if (!text) return "";
  return `<section class="detail-block"><h4>${escapeHtml(title)}</h4><p>${renderLinkedText(text)}</p></section>`;
}

function meaningBlock(value) {
  const items = splitAmpersandList(value);
  if (!items.length) return "";

  if (items.length === 1) {
    return `<section class="detail-block meaning-block"><h4>語義說明</h4><p>${renderMeaningText(items[0])}</p></section>`;
  }

  const list = items.map((item, index) => `
    <li class="meaning-item">
      <span class="meaning-item__badge">${String(index + 1).padStart(2, "0")}</span>
      <span class="meaning-item__text">${renderMeaningText(item)}</span>
    </li>
  `).join("");

  return `<section class="detail-block meaning-block"><h4>語義說明</h4><ul class="meaning-list">${list}</ul></section>`;
}

function renderMeaningText(text) {
  return renderLinkedText(text).replaceAll("貶義。", `<span class="negative-meaning">貶義</span>`);
}

function sourceBlock(item) {
  const title = cleanSourceTitle(item.典源文獻名稱);
  const paragraphs = sourceParagraphs(item.典源文獻內容);
  if (!title && !paragraphs.length) return "";

  const heading = title ? `<h5 class="source-title">${escapeHtml(title)}</h5>` : "";
  const content = paragraphs.length
    ? paragraphs.map(paragraph => `<p>${renderLinkedText(paragraph)}</p>`).join("")
    : `<p class="empty-state">此條目未提供典源文獻內容。</p>`;

  return `<section class="detail-block source-block"><h4>典源文獻</h4>${heading}<div class="source-content">${content}</div></section>`;
}

function usageContextBlock(value) {
  const items = splitUsageContexts(value);
  if (!items.length) return "";

  if (items.length === 1) {
    return `<section class="detail-block usage-context-block"><h4>使用情境</h4><p>${renderLinkedText(items[0])}</p></section>`;
  }

  const list = items.map((item, index) => `
    <li class="usage-context-item">
      <span class="usage-context-item__badge">${String(index + 1).padStart(2, "0")}</span>
      <span class="usage-context-item__text">${renderLinkedText(item)}</span>
    </li>
  `).join("");

  return `<section class="detail-block usage-context-block"><h4>使用情境</h4><ul class="usage-context-list">${list}</ul></section>`;
}

function identificationBlock(item) {
  const sections = [
    ["形音辨誤", item["辨識-形音辨誤"]],
    ["相同辨析", item["辨識-同"]],
    ["差異辨析", item["辨識-異"]]
  ].map(([label, value]) => {
    const text = cleanText(joinText(value));
    if (!text) return "";

    return `
      <section class="identification-item">
        <h5>${escapeHtml(label)}</h5>
        <p>${renderLinkedText(text)}</p>
      </section>
    `;
  }).filter(Boolean);

  if (!sections.length) return "";
  return `<section class="detail-block identification-block"><h4>辨識</h4><div class="identification-list">${sections.join("")}</div></section>`;
}

function listBlock(title, values, limit, highlightTerm = "") {
  const isExamples = title === "用法例句";
  const isEvidence = title === "書證";
  const items = Array.isArray(values)
    ? uniqueItems(
        values.map(cleanText).filter(item => item && (!isExamples || hasMeaningfulText(item))),
        isEvidence ? evidenceContentKey : item => item
      ).slice(0, limit)
    : [];
  if (!items.length) return "";
  const className = isExamples ? "detail-block example-block" : isEvidence ? "detail-block evidence-block" : "detail-block";
  const listClass = isExamples ? " class=\"example-list\"" : isEvidence ? " class=\"evidence-list\"" : "";
  const list = items.map((item, index) => {
    if (isExamples) {
      return `
        <li class="example-item">
          <span class="example-item__badge">例 ${index + 1}</span>
          <span class="example-item__text">${renderLinkedText(item, highlightTerm)}</span>
        </li>
      `;
    }

    if (isEvidence) return renderEvidenceItem(item);

    return `<li>${renderLinkedText(item)}</li>`;
  }).join("");

  return `<section class="${className}"><h4>${escapeHtml(title)}</h4><ul${listClass}>${list}</ul></section>`;
}

function identificationQuizBlock(item) {
  const quiz = item._quiz || parseIdentificationQuiz(item["辨識-例句"]);
  if (!quiz) return "";

  const quizId = `quiz-${String(item.編號 || item.成語 || "idiom")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .toLowerCase()
    .slice(0, 32)}`;

  const questions = quiz.questions
    .map((question, index) => {
      const parts = splitPlaceholderSentence(question.sentence);
      if (parts.length < 2) return "";

      const before = renderLinkedText(parts[0] || "");
      const after = renderLinkedText(parts.slice(1).join(""));
      const selectId = `${quizId}-${index}`;
      const correct = question.correct;

      return `
        <div class="quiz-question">
          <label for="${selectId}" class="sr-only">填空題 ${index + 1}</label>
          <p class="quiz-sentence">
            ${before}<select
              id="${selectId}"
              class="quiz-select"
              data-correct="${escapeHtml(correct)}"
              data-option-a="${escapeHtml(quiz.options[0])}"
              data-option-b="${escapeHtml(quiz.options[1])}"
              aria-label="選擇適合此空格的成語"
            >
              <option value="" disabled selected>請選擇</option>
              <option value="0">${escapeHtml(quiz.options[0])}</option>
              <option value="1">${escapeHtml(quiz.options[1])}</option>
              <option value="both">兩者皆可</option>
            </select>${after}
          </p>
          <p class="quiz-feedback" role="status" aria-live="polite">請先選擇答案。</p>
          <span class="quiz-celebration" aria-hidden="true">
            <i></i><i></i><i></i><i></i><i></i>
          </span>
        </div>
      `;
    })
    .join("");

  return `
    <section class="detail-block quiz-block">
      <h4>趣味測驗</h4>
      <p class="quiz-instruction">以下句子有一個空格，請選擇最適合的成語。</p>
      <div class="quiz-question-list">${questions}</div>
    </section>
  `;
}

function parseIdentificationQuiz(rawValue) {
  if (!Array.isArray(rawValue) || rawValue.length < 2) return null;

  const options = String(rawValue[0] || "")
    .split("\t")
    .map(item => cleanText(item))
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (options.length < 2) return null;

  const questions = rawValue
    .slice(1)
    .map(item => parseIdentificationQuestion(item))
    .filter(Boolean);

  if (!questions.length) return null;
  return { options, questions };
}

function parseIdentificationQuestion(rawItem) {
  if (typeof rawItem !== "string") return null;

  const parts = rawItem.split("\t");
  if (parts.length < 3) return null;

  const sentence = parts.slice(2).join("\t").trim();
  const sentenceParts = splitPlaceholderSentence(sentence);
  if (sentenceParts.length < 2) return null;

  const firstMark = isCorrectMarker(parts[0]);
  const secondMark = isCorrectMarker(parts[1]);
  let correct = "";

  if (firstMark && secondMark) correct = "both";
  else if (firstMark) correct = "0";
  else if (secondMark) correct = "1";

  if (!correct) return null;
  return { sentence, correct };
}

function splitPlaceholderSentence(sentence) {
  return String(sentence || "").split(/[~∼]/);
}

function isCorrectMarker(value) {
  return String(value || "").trim().includes("○");
}

function bindIdentificationQuizEvents() {
  els.modalContent.querySelectorAll(".quiz-select").forEach(select => {
    select.addEventListener("change", handleQuizAnswer);
  });
}

function handleQuizAnswer(event) {
  const select = event.target;
  const question = select.closest(".quiz-question");
  if (!question) return;

  const feedback = question.querySelector(".quiz-feedback");
  const celebration = question.querySelector(".quiz-celebration");
  const correct = select.dataset.correct || "";
  const optionA = select.dataset.optionA || "";
  const optionB = select.dataset.optionB || "";
  const selected = select.value;

  select.classList.remove("is-correct", "is-wrong");
  question.classList.remove("is-correct", "is-wrong");
  feedback.classList.remove("is-correct", "is-wrong");

  if (!selected) {
    feedback.textContent = "請先選擇答案。";
    return;
  }

  const selectedText = selected === "both" ? "兩者皆可" : selected === "0" ? optionA : optionB;
  const isCorrect = selected === correct;

  if (isCorrect) {
    select.classList.add("is-correct");
    question.classList.add("is-correct");
    feedback.classList.add("is-correct");
    feedback.textContent = `答對了！「${selectedText}」就是這句的關鍵成語。`;
    if (celebration) {
      celebration.classList.remove("is-active");
      void celebration.offsetWidth;
      celebration.classList.add("is-active");
    }
    return;
  }

  select.classList.add("is-wrong");
  question.classList.add("is-wrong");
  feedback.classList.add("is-wrong");
  feedback.textContent = `再想想，${selectedText} 不是這句的正確答案。`;
}

function renderEvidenceItem(item) {
  const text = String(item || "").trim();
  const sectionPrefixMatch = text.match(/^([（(][一二三四五六七八九十]+[）)])\s*(.*)$/);
  if (sectionPrefixMatch) {
    const heading = `<li class="evidence-subheading">${escapeHtml(sectionPrefixMatch[1])}</li>`;
    const remainingText = sectionPrefixMatch[2].trim();
    return remainingText ? `${heading}${renderEvidenceItem(remainingText)}` : heading;
  }

  const sectionMatch = text.match(/^[（(][一二三四五六七八九十]+[）)]$/);
  if (sectionMatch) {
    return `<li class="evidence-subheading">${escapeHtml(sectionMatch[0])}</li>`;
  }

  const match = text.match(/^(\d\d\.)\s*(.*)$/);
  if (!match) return `<li>${renderLinkedText(text)}</li>`;

  return `
    <li class="evidence-item">
      <span class="evidence-item__badge">${escapeHtml(match[1].replace(".", ""))}</span>
      <span class="evidence-item__text">${renderLinkedText(match[2])}</span>
    </li>
  `;
}

function idiomListBlock(title, value) {
  const items = splitIdiomList(value);
  if (!items.length) return "";

  const list = items.map(name => {
    const content = state.idiomByName.has(name)
      ? `<button class="idiom-list-link" type="button" data-related-idiom="${escapeHtml(name)}">${escapeHtml(name)}</button>`
      : `<span class="idiom-list-text">${escapeHtml(name)}</span>`;

    return `<li>${content}</li>`;
  }).join("");

  return `<section class="detail-block idiom-list-block"><h4>${escapeHtml(title)}</h4><ul class="idiom-term-list">${list}</ul></section>`;
}

function toggleFavorite(item) {
  const key = String(item.編號 || item.成語);
  const keys = new Set(state.favorites);

  if (keys.has(key)) keys.delete(key);
  else keys.add(key);

  applyFavoriteCollectionFavorites(keys);
  saveFavorites();
  renderFavorites();

  if (state.resultsMode === "favorites") {
    renderFavoritesModeResults();
    return;
  }

  renderResults(searchIdioms());
}

function renderFavorites() {
  const saved = favoriteItems();

  syncFavoritesCount(saved.length);

  if (!saved.length) {
    els.favoritesList.innerHTML = `<p class="empty-state">還沒有收藏。遇到喜歡的成語，就把它放進自己的小書籤。</p>`;
    return;
  }

  els.favoritesList.innerHTML = saved.map(item => {
    const id = escapeHtml(String(item.編號 || item.成語));
    const name = escapeHtml(item.成語);

    return `
      <div class="favorite-list-item" data-favorite-id="${id}">
        <button class="favorite-item-button" type="button" data-action="open" data-id="${id}">${name}</button>
        <button class="favorite-remove-button" type="button" data-action="remove" data-id="${id}" aria-label="刪除收藏：${name}">
          <span aria-hidden="true">×</span>
        </button>
      </div>
    `;
  }).join("");

  els.favoritesList.querySelectorAll(".favorite-list-item").forEach(item => {
    item.addEventListener("pointerdown", handleFavoritePointerDown);
    item.addEventListener("mousedown", handleFavoritePointerDown);
  });

  els.favoritesList.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", event => {
      if (suppressFavoriteClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const item = saved.find(entry => String(entry.編號 || entry.成語) === button.dataset.id);
      if (!item) return;

      if (button.dataset.action === "remove") {
        removeFavoriteWithEffect(item, button);
        return;
      }

      els.input.value = "";
      state.query = "";
      renderFavoritesModeResults();
      openIdiomModal(item, true, "replace");
    });
   });
}

function renderFavoriteCollections() {
  const collections = [...state.favoriteCollections];
  if (!els.favoriteCollectionsList) return;

  if (!collections.length) {
    els.favoriteCollectionsList.innerHTML = `<p class="empty-state">尚未有其他收藏清單。</p>`;
    return;
  }

  els.favoriteCollectionsList.innerHTML = collections.map(item => {
    const id = escapeHtml(item.id);
    const title = escapeHtml(normalizeFavoriteTitle(item.title || DEFAULT_FAVORITES_TITLE));
    const isDefault = item.id === DEFAULT_FAVORITE_COLLECTION_ID;
    const isActive = item.id === state.activeFavoriteCollectionId;

    return `
      <div class="favorite-list-item ${isActive ? "is-active" : ""}" data-favorite-list-id="${id}">
        <button class="favorite-item-button" type="button" data-action="open" data-favorite-list-id="${id}">${title}</button>
        ${isDefault ? "" : `
          <button class="favorite-remove-button" type="button" data-action="remove" data-favorite-list-id="${id}" aria-label="刪除收藏清單：${title}">
            <span aria-hidden="true">×</span>
          </button>
        `}
      </div>
    `;
  }).join("");

  els.favoriteCollectionsList.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", event => {
      if (suppressFavoriteClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const collectionId = button.dataset.favoriteListId || "";
  if (!collectionId) return;

      if (button.dataset.action === "remove") {
        removeFavoriteCollectionById(collectionId, {
          shouldScrollToResults: false
        });
        return;
      }

      switchFavoriteCollection(collectionId);
    });
  });
}

function favoriteItems() {
  return [...state.favorites]
    .map(key => state.idioms.find(item => String(item.編號 || item.成語) === key))
    .filter(Boolean);
}

function renderFavoritesModeResults() {
  const favorites = favoriteItems();
  if (favorites.length) {
    renderResults(favorites, {
      label: `顯示 ${favorites.length} 筆收藏`,
      mode: "favorites"
    });
    return;
  }

  renderResults(fallbackFavoriteResults(), { mode: "favorites" });
}

  function syncFavoritesCount(count = state.favorites.size) {
  if (!els.favoritesCount) return;
  els.favoritesCount.textContent = `${count.toLocaleString("zh-TW")} 筆`;
}

function getActiveFavoriteCollection() {
  return getFavoriteCollectionById(state.activeFavoriteCollectionId) || state.favoriteCollections[0];
}

function getFavoriteCollectionById(collectionId) {
  return state.favoriteCollections.find(item => item.id === collectionId) || null;
}

function applyFavoriteCollectionFavorites(keys) {
  const activeCollection = getActiveFavoriteCollection();
  if (!activeCollection) return;

  const inputKeys = keys ? (Array.isArray(keys) ? keys : [...keys]) : [];
  activeCollection.favorites = [...new Set(normalizeStoredFavoriteKeys(inputKeys))];
  state.favorites = new Set(activeCollection.favorites);
}

function switchFavoriteCollection(collectionId, options = {}) {
  const target = getFavoriteCollectionById(collectionId);
  if (!target) return;
  const shouldScrollToResults = options.shouldScrollToResults !== false;

  state.activeFavoriteCollectionId = target.id;
  state.favoritesTitle = target.title;
  state.favorites = new Set(target.favorites);
  state.currentPage = 1;
  state.query = "";
  els.input.value = "";

  syncFavoritesTitle();
  renderFavorites();
  renderFavoriteCollections();
  syncFavoritesCount();
  renderFavoritesModeResults();
  if (shouldScrollToResults) {
    scrollToFavoritesTitle();
  }
  saveFavorites();
}

function removeFavoriteCollectionById(collectionId, options = {}) {
  if (collectionId === DEFAULT_FAVORITE_COLLECTION_ID) return;

  const shouldScrollToResults = options.shouldScrollToResults !== false;
  return withPreservedScroll(() => {
    const index = state.favoriteCollections.findIndex(item => item.id === collectionId);
    if (index === -1) return;

    const removedTitle = normalizeFavoriteTitle(state.favoriteCollections[index]?.title || DEFAULT_FAVORITES_TITLE);
    state.favoriteCollections.splice(index, 1);
    if (removedTitle) setFavoritesStatus(`已刪除收藏清單「${removedTitle}」`);

    if (state.activeFavoriteCollectionId === collectionId) {
      state.activeFavoriteCollectionId = DEFAULT_FAVORITE_COLLECTION_ID;
      const active = getActiveFavoriteCollection();
      state.favorites = new Set(active ? active.favorites : []);
      state.favoritesTitle = active ? active.title : DEFAULT_FAVORITES_TITLE;
      syncFavoritesTitle();
      renderFavorites();
      syncFavoritesCount();
      state.query = "";
      els.input.value = "";
      renderFavoritesModeResults();
      if (shouldScrollToResults) {
        scrollToFavoritesTitle();
      }
    }

    renderFavoriteCollections();
    saveFavorites();
  });
}

function addFavoriteCollection(rawCollection) {
  const normalized = normalizeFavoriteCollection(rawCollection, state.favoriteCollections.length);
  if (!normalized) return null;

  const collectionId = resolveFavoriteCollectionId(normalized.id);
  normalized.id = collectionId;
  state.favoriteCollections.push(normalized);
  return normalized.id;
}

function resolveFavoriteCollectionId(collectionId) {
  let candidateId = String(collectionId || "").trim() || `collection-${Date.now()}`;
  if (!state.favoriteCollections.some(item => item.id === candidateId)) return candidateId;

  while (state.favoriteCollections.some(item => item.id === candidateId)) {
    candidateId = `${collectionId}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  }

  return candidateId;
}

function findFavoriteCollectionByTitleAndFavorites(title, favorites) {
  const normalizedTitle = normalizeFavoriteTitle(title);
  return state.favoriteCollections.find(item =>
    normalizeFavoriteTitle(item.title || "") === normalizedTitle &&
    isSameFavoriteCollectionContent(item.favorites, favorites)
  ) || null;
}

function createFavoriteCollectionForEditing(rawCollection, editOptions = {}, autoStartEditing = true) {
  const collectionId = addFavoriteCollection(rawCollection);
  if (!collectionId) return null;

  switchFavoriteCollection(collectionId, {
    shouldScrollToResults: !Boolean(editOptions.skipScrollToResults)
  });
  if (autoStartEditing) {
    startFavoriteTitleEdit(editOptions);
  }
  return collectionId;
}

function captureScrollPosition() {
  return {
    left: window.scrollX || window.pageXOffset,
    top: window.scrollY || window.pageYOffset
  };
}

function restoreScrollPosition(scrollPosition, attempts = 0) {
  if (!scrollPosition) return;
  if (window.scrollX === scrollPosition.left && window.scrollY === scrollPosition.top) return;

  window.scrollTo({
    left: scrollPosition.left,
    top: scrollPosition.top,
    behavior: "auto"
  });

  if (attempts < 6) {
    window.requestAnimationFrame(() => restoreScrollPosition(scrollPosition, attempts + 1));
  }
}

function withPreservedScroll(action) {
  const scrollPosition = captureScrollPosition();
  const result = action();

  if (result && typeof result.then === "function") {
    return result.finally(() => {
      restoreScrollPosition(scrollPosition);
    });
  }

  restoreScrollPosition(scrollPosition);
  return result;
}

function uniqueFavoriteCollectionTitle(baseTitle) {
  const normalizedBase = normalizeFavoriteTitle(baseTitle);
  const usedTitles = new Set(
    state.favoriteCollections.map(item => normalizeFavoriteTitle(item.title || ""))
  );

  if (!usedTitles.has(normalizedBase)) {
    return normalizedBase;
  }

  let index = 1;
  while (usedTitles.has(`${normalizedBase}（${index}）`)) {
    index += 1;
  }

  return `${normalizedBase}（${index}）`;
}

function uniqueDuplicatedFavoriteCollectionTitle(baseTitle) {
  const cleanedTitle = normalizeFavoriteTitle(baseTitle).replace(/（\d+）$/u, "");
  const normalizedBase = normalizeFavoriteTitle(cleanedTitle);
  const usedTitles = new Set(
    state.favoriteCollections.map(item => normalizeFavoriteTitle(item.title || ""))
  );

  let index = 1;
  let candidate = `${normalizedBase}（${index}）`;
  while (usedTitles.has(candidate)) {
    index += 1;
    candidate = `${normalizedBase}（${index}）`;
  }

  return candidate;
}

function clearFavoriteShareHash() {
  if (!window.location.hash) return;
  const url = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState({}, "", url);
}

function getFavoriteCollectionTitleOrDefault(indexedTitle) {
  return indexedTitle || `收藏清單 ${formatDateForFile(new Date())}`;
}

function applyFavoriteCollectionTitleFromFragment(rawTitle, favorites) {
  const baseTitle = getFavoriteCollectionTitleOrDefault(rawTitle);
  const duplicateCollection = findFavoriteCollectionByTitleAndFavorites(baseTitle, favorites);

  if (duplicateCollection) {
    return {
      title: baseTitle,
      collectionId: duplicateCollection.id,
      shouldImport: false
    };
  }

  return {
    title: uniqueFavoriteCollectionTitle(baseTitle),
    shouldImport: true
  };
}

function isSameFavoriteCollectionContent(leftFavorites, rightFavorites) {
  const left = normalizeStoredFavoriteKeys(leftFavorites).sort();
  const right = normalizeStoredFavoriteKeys(rightFavorites).sort();

  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function normalizeFavoriteCollection(rawCollection, fallbackIndex) {
  if (!rawCollection || typeof rawCollection !== "object") return null;

  const id = String(rawCollection.id || "").trim() || `collection-${Date.now()}-${fallbackIndex}-${Math.random().toString(36).slice(2, 8)}`;
  const title = normalizeFavoriteTitle(
    rawCollection.title
      ? String(rawCollection.title)
      : DEFAULT_FAVORITES_TITLE
  );
  const favorites = normalizeStoredFavoriteKeys(rawCollection.favorites || []);

  return {
    id,
    title,
    favorites
  };
}

function removeFavoriteWithEffect(item, button) {
  const key = String(item.編號 || item.成語);
  const listItem = button.closest(".favorite-list-item");

  if (!listItem) {
    removeFavoriteItem(item);
    return;
  }

  suppressFavoriteClick = true;
  listItem.classList.add("is-removing");
  const ashFinished = createFavoriteRowAshEffect(listItem);

  const height = listItem.getBoundingClientRect().height;
  listItem.style.height = `${height}px`;
  const peelAnimation = listItem.animate(
    [
      {
        clipPath: "inset(0 0 0 0)",
        filter: "grayscale(0)",
        opacity: 1
      },
      {
        clipPath: "inset(0 100% 0 0)",
        filter: "grayscale(1)",
        opacity: 0.18
      }
    ],
    {
      duration: 820,
      easing: "cubic-bezier(0.32, 0, 0.2, 1)",
      fill: "forwards"
    }
  );

  Promise.all([ashFinished, peelAnimation.finished.catch(() => {})])
    .then(() => collapseFavoriteListItem(listItem, height))
    .catch(() => {})
    .finally(() => {
      listItem.style.height = "";
      removeFavoriteItem(item);
      window.setTimeout(() => {
        suppressFavoriteClick = false;
      }, 0);
    });
}

function collapseFavoriteListItem(listItem, height) {
  return listItem.animate(
    [
      {
        height: `${height}px`,
        opacity: 0,
        transform: "translate3d(0, 0, 0)"
      },
      {
        height: "0px",
        opacity: 0,
        transform: "translate3d(0, -6px, 0)"
      }
    ],
    {
      duration: 260,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "forwards"
    }
  ).finished;
}

function removeFavoriteItem(item) {
  withPreservedScroll(() => {
    applyFavoriteCollectionFavorites([...state.favorites].filter(value => value !== String(item.編號 || item.成語)));
    saveFavorites();
    renderFavorites();
    renderResults(searchIdioms());
    setFavoritesStatus(`已刪除「${item.成語}」`);
  });
}

function createFavoriteRowAshEffect(listItem) {
  const rect = listItem.getBoundingClientRect();
  const burst = document.createElement("span");
  const peelFront = document.createElement("span");
  const columns = 32;
  const rows = 8;
  const particles = [];
  const startedAt = performance.now();
  const duration = 720;

  burst.className = "favorite-remove-burst";
  burst.setAttribute("aria-hidden", "true");
  burst.style.left = `${rect.left}px`;
  burst.style.top = `${rect.top}px`;
  burst.style.width = `${rect.width}px`;
  burst.style.height = `${rect.height}px`;
  burst.style.setProperty("--peel-distance", `${rect.width + 36}px`);

  peelFront.className = "favorite-peel-front";
  peelFront.setAttribute("aria-hidden", "true");
  burst.append(peelFront);

  for (let index = 0; index < columns * rows; index += 1) {
    const ash = document.createElement("span");
    const column = index % columns;
    const row = Math.floor(index / columns);
    const jitterX = (Math.random() - 0.5) * 14;
    const jitterY = (Math.random() - 0.5) * 12;
    const x = (columns === 1 ? 0 : (column / (columns - 1)) * rect.width) + jitterX;
    const y = (rows === 1 ? 0 : (row / (rows - 1)) * rect.height) + jitterY;
    const angle = Math.random() * Math.PI * 2;
    const speed = 9 + Math.random() * 18;
    const size = 1.2 + Math.random() * 2.2;
    const peelDelay = (columns - 1 - column) * 18 + Math.random() * 90 + row * 8;
    const isEmber = Math.random() < 0.16;

    if (isEmber) ash.classList.add("is-ember");
    ash.style.left = `${x}px`;
    ash.style.top = `${y}px`;
    ash.style.setProperty("--ash-size", `${isEmber ? size + 0.8 : size}px`);
    burst.append(ash);
    particles.push({
      element: ash,
      baseX: x,
      baseY: y,
      x: 0,
      y: 0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rotation: Math.random() * 180,
      spin: (Math.random() - 0.5) * 140,
      drag: 0.88 + Math.random() * 0.08,
      delay: peelDelay,
      duration: isEmber ? 420 + Math.random() * 220 : 560 + Math.random() * 260,
      maxOpacity: isEmber ? 0.98 : 0.78,
      scaleBoost: isEmber ? 1.25 : 0.65
    });
  }

  document.body.append(burst);
  return new Promise(resolve => {
    requestAnimationFrame(now => updateFavoriteAshParticles(burst, particles, startedAt, now, duration, resolve));
  });
}

function updateFavoriteAshParticles(burst, particles, startedAt, now, duration, resolve) {
  if (!burst.isConnected) {
    resolve();
    return;
  }

  const elapsed = now - startedAt;
  const gravity = 0;
  const margin = 50;
  const nextParticles = [];

  particles.forEach((particle, index) => {
    const localElapsed = elapsed - particle.delay;
    if (localElapsed < 0) {
      nextParticles.push(particle);
      return;
    }

    const progress = Math.min(localElapsed / particle.duration, 1);
    const dt = 1 / 60;
    const turbulenceX = Math.sin((elapsed + index * 37) * 0.012) * 4;
    const turbulenceY = Math.cos((elapsed + index * 53) * 0.01) * 4;
    particle.vx = particle.vx * particle.drag + turbulenceX * dt;
    particle.vy = particle.vy * particle.drag + (gravity + turbulenceY) * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.x = Math.min(Math.max(particle.x, -particle.baseX - margin), burst.offsetWidth + margin - particle.baseX);
    particle.y = Math.min(Math.max(particle.y, -particle.baseY - margin), burst.offsetHeight + margin - particle.baseY);
    particle.rotation += particle.spin * dt;

    const opacity = Math.max(0, 0.92 * (1 - progress) ** 1.15);
    const scale = 0.68 + progress * particle.scaleBoost;
    particle.element.style.opacity = String(Math.min(opacity, particle.maxOpacity));
    particle.element.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0) rotate(${particle.rotation}deg) scale(${scale})`;

    if (progress < 1) nextParticles.push(particle);
  });

  if (nextParticles.length) {
    requestAnimationFrame(nextNow => updateFavoriteAshParticles(burst, nextParticles, startedAt, nextNow, duration, resolve));
  } else {
    burst.remove();
    resolve();
  }
}

function handleFavoritePointerDown(event) {
  if (favoritePointerDrag) return;
  if (event.button !== 0 || event.target.closest(".favorite-remove-button")) return;

  const item = event.currentTarget;
  const favoriteId = item.dataset.favoriteId || "";
  if (!favoriteId) return;

  const isTouchDrag = isTouchLikeFavoriteDrag(event);
  const pointerId = getFavoritePointerId(event);
  favoritePointerDrag = {
    id: favoriteId,
    pointerId,
    source: item,
    sourceIndex: [...state.favorites].indexOf(favoriteId),
    startX: event.clientX,
    startY: event.clientY,
    targetId: "",
    placeAfterTarget: false,
    isDragging: false,
    isLongPressEnabled: isTouchDrag,
    isLongPressReady: true,
    preview: null,
    offsetX: 0,
    offsetY: 0
  };

  if (isTouchDrag) {
    clearFavoriteLongPressTimer();
    favoriteLongPressTimer = window.setTimeout(() => {
      if (!favoritePointerDrag || favoritePointerDrag.pointerId !== pointerId || !favoritePointerDrag.isLongPressReady) return;
      favoritePointerDrag.isDragging = true;
      favoritePointerDrag.isLongPressEnabled = false;
      favoritePointerDrag.sourceIndex = [...state.favorites].indexOf(favoriteId);
      favoritePointerDrag.source.classList.add("is-dragging");
      createFavoriteDragPreview(favoritePointerDrag, event);
      suppressFavoriteClick = true;
    }, FAVORITE_LONG_PRESS_DELAY);
    return;
  }

  favoritePointerDrag.isLongPressEnabled = false;
  favoritePointerDrag.isLongPressReady = false;
}

function handleFavoritePointerMove(event) {
  if (!favoritePointerDrag || favoritePointerDrag.pointerId !== getFavoritePointerId(event)) return;

  if (favoritePointerDrag.isLongPressEnabled) {
    const deltaX = event.clientX - favoritePointerDrag.startX;
    const deltaY = event.clientY - favoritePointerDrag.startY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance > FAVORITE_DRAG_THRESHOLD) {
      favoritePointerDrag.isLongPressReady = false;
      clearFavoriteLongPressTimer();
      return;
    }
    return;
  }

  const deltaX = event.clientX - favoritePointerDrag.startX;
  const deltaY = event.clientY - favoritePointerDrag.startY;
  const distance = Math.hypot(deltaX, deltaY);

  if (!favoritePointerDrag.isDragging) {
    if (distance < FAVORITE_DRAG_THRESHOLD) return;

    favoritePointerDrag.isDragging = true;
    favoritePointerDrag.source.classList.add("is-dragging");
    createFavoriteDragPreview(favoritePointerDrag, event);
    suppressFavoriteClick = true;
  }

  event.preventDefault();
  updateFavoriteDragPreview(favoritePointerDrag, event.clientX, event.clientY);
  clearFavoriteDropMarkers();

  const target = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest(".favorite-list-item");

  if (!target || !els.favoritesList.contains(target) || target.dataset.favoriteId === favoritePointerDrag.id) {
    favoritePointerDrag.targetId = "";
    favoritePointerDrag.placeAfterTarget = false;
    updateFavoriteDragPreviewIndex(favoritePointerDrag);
    return;
  }

  favoritePointerDrag.targetId = target.dataset.favoriteId || "";
  favoritePointerDrag.placeAfterTarget = setFavoriteDropPosition(target, event.clientY);
  updateFavoriteDragPreviewIndex(favoritePointerDrag);
}

function handleFavoritePointerUp(event) {
  if (!favoritePointerDrag || favoritePointerDrag.pointerId !== getFavoritePointerId(event)) return;
  clearFavoriteLongPressTimer();

  const drag = favoritePointerDrag;
  const shouldReorder = drag.isDragging && drag.targetId;

  if (drag.isDragging) {
    event.preventDefault();
    suppressFavoriteClick = true;
  }

  if (shouldReorder) {
    finishFavoriteReorder(drag);
    return;
  }

  cancelFavoritePointerDrag();
}

function cancelFavoritePointerDrag() {
  const drag = favoritePointerDrag;
  clearFavoriteLongPressTimer();
  const wasDragging = drag?.isDragging;
  favoritePointerDrag = null;
  clearFavoriteDragState(drag);

  if (wasDragging) {
    window.setTimeout(() => {
      suppressFavoriteClick = false;
    }, 0);
  }
}

function getFavoritePointerId(event) {
  return event.pointerId ?? "mouse";
}

function isTouchLikeFavoriteDrag(event) {
  if (event.pointerType === "touch") return true;
  return window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(max-width: 767px)").matches;
}

function clearFavoriteLongPressTimer() {
  if (favoriteLongPressTimer) {
    window.clearTimeout(favoriteLongPressTimer);
    favoriteLongPressTimer = 0;
  }
}

function createFavoriteDragPreview(drag, event) {
  const rect = drag.source.getBoundingClientRect();
  const preview = drag.source.cloneNode(true);

  drag.offsetX = event.clientX - rect.left;
  drag.offsetY = event.clientY - rect.top;
  drag.preview = preview;

  preview.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
  preview.classList.add("favorite-drag-preview");
  preview.setAttribute("aria-hidden", "true");
  updateFavoriteDragPreviewIndex(drag);
  preview.inert = true;
  preview.querySelectorAll("button").forEach(button => {
    button.tabIndex = -1;
  });
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  updateFavoriteDragPreview(drag, event.clientX, event.clientY);

  document.body.append(preview);
}

function updateFavoriteDragPreview(drag, clientX, clientY) {
  if (!drag.preview) return;

  const x = Math.round(clientX - drag.offsetX);
  const y = Math.round(clientY - drag.offsetY);
  drag.preview.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function updateFavoriteDragPreviewIndex(drag) {
  if (!drag.preview) return;

  drag.preview.dataset.previewIndex = String(getFavoritePreviewIndex(drag));
}

function getFavoritePreviewIndex(drag) {
  const favoriteKeys = [...state.favorites];
  const sourceIndex = favoriteKeys.indexOf(drag.id);
  if (sourceIndex === -1) return 1;

  if (!drag.targetId) return sourceIndex + 1;

  const orderedKeys = favoriteKeys.filter(key => key !== drag.id);
  let insertIndex = orderedKeys.indexOf(drag.targetId);
  if (insertIndex === -1) return sourceIndex + 1;
  if (drag.placeAfterTarget) insertIndex += 1;

  return insertIndex + 1;
}

function setFavoriteDropPosition(item, clientY) {
  const dropAfter = isFavoriteDropAfter(item, clientY);
  item.classList.toggle("is-drop-before", !dropAfter);
  item.classList.toggle("is-drop-after", dropAfter);
  return dropAfter;
}

function isFavoriteDropAfter(item, clientY) {
  const rect = item.getBoundingClientRect();
  return clientY > rect.top + rect.height / 2;
}

function clearFavoriteDropPosition(item) {
  item.classList.remove("is-drop-before", "is-drop-after");
}

function clearFavoriteDropMarkers() {
  els.favoritesList.querySelectorAll(".favorite-list-item").forEach(item => {
    clearFavoriteDropPosition(item);
  });
}

function clearFavoriteDragState(drag = null) {
  drag?.preview?.remove();
  document.querySelectorAll(".favorite-drag-preview").forEach(preview => {
    preview.remove();
  });

  els.favoritesList.querySelectorAll(".favorite-list-item").forEach(item => {
    item.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
  });
}

function finishFavoriteReorder(drag) {
  const oldRects = getFavoriteItemRects();
  const favoriteKeys = reorderedFavoriteKeys(drag.id, drag.targetId, drag.placeAfterTarget);
  favoritePointerDrag = null;
  clearFavoriteDropMarkers();

  if (!favoriteKeys) {
    clearFavoriteDragState(drag);
    window.setTimeout(() => {
      suppressFavoriteClick = false;
    }, 0);
    return;
  }

  applyFavoriteCollectionFavorites(favoriteKeys);
  saveFavorites();
  renderFavorites();
  setFavoritesStatus("已更新收藏順序");

  animateFavoriteInsertion(drag, oldRects).finally(() => {
    window.setTimeout(() => {
      suppressFavoriteClick = false;
    }, 0);
  });
}

function getFavoriteItemRects() {
  return new Map(
    [...els.favoritesList.querySelectorAll(".favorite-list-item")]
      .map(item => [item.dataset.favoriteId || "", item.getBoundingClientRect()])
      .filter(([id]) => id)
  );
}

function reorderedFavoriteKeys(sourceId, targetId, placeAfterTarget) {
  const favoriteKeys = [...state.favorites];
  const sourceIndex = favoriteKeys.indexOf(sourceId);
  const targetIndex = favoriteKeys.indexOf(targetId);

  if (sourceIndex === -1 || targetIndex === -1) return null;

  const [sourceKey] = favoriteKeys.splice(sourceIndex, 1);
  let insertIndex = favoriteKeys.indexOf(targetId);
  if (placeAfterTarget) insertIndex += 1;

  favoriteKeys.splice(insertIndex, 0, sourceKey);
  return favoriteKeys;
}

function animateFavoriteInsertion(drag, oldRects) {
  if (!drag?.preview || !oldRects?.size || !("animate" in Element.prototype)) {
    clearFavoriteDragState(drag);
    return Promise.resolve();
  }

  const items = [...els.favoritesList.querySelectorAll(".favorite-list-item")];
  const destinationItem = items.find(item => item.dataset.favoriteId === drag.id);
  if (!destinationItem) {
    clearFavoriteDragState(drag);
    return Promise.resolve();
  }

  const destinationRect = destinationItem.getBoundingClientRect();
  const previewRect = drag.preview.getBoundingClientRect();
  const animations = [];

  destinationItem.style.opacity = "0";
  drag.preview.style.transform = `translate3d(${Math.round(previewRect.left)}px, ${Math.round(previewRect.top)}px, 0)`;
  drag.preview.style.width = `${destinationRect.width}px`;
  drag.preview.style.height = `${destinationRect.height}px`;
  drag.preview.dataset.previewIndex = String([...state.favorites].indexOf(drag.id) + 1);

  items.forEach(item => {
    const id = item.dataset.favoriteId || "";
    if (id === drag.id) return;

    const oldRect = oldRects.get(id);
    if (!oldRect) return;

    const newRect = item.getBoundingClientRect();
    const deltaX = oldRect.left - newRect.left;
    const deltaY = oldRect.top - newRect.top;
    if (!deltaX && !deltaY) return;

    animations.push(item.animate(
      [
        { transform: `translate3d(${Math.round(deltaX)}px, ${Math.round(deltaY)}px, 0)` },
        { transform: "translate3d(0, 0, 0)" }
      ],
      {
        duration: 280,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)"
      }
    ).finished.catch(() => {}));
  });

  animations.push(drag.preview.animate(
    [
      {
        transform: `translate3d(${Math.round(previewRect.left)}px, ${Math.round(previewRect.top)}px, 0)`,
        opacity: 0.98
      },
      {
        transform: `translate3d(${Math.round(destinationRect.left)}px, ${Math.round(destinationRect.top)}px, 0)`,
        opacity: 1
      }
    ],
    {
      duration: 260,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "forwards"
    }
  ).finished.catch(() => {}));

  return Promise.all(animations)
    .then(() => {
      drag.preview.style.transform = `translate3d(${Math.round(destinationRect.left)}px, ${Math.round(destinationRect.top)}px, 0)`;

      const settleAnimations = [
        destinationItem.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          {
            duration: 90,
            easing: "ease-out",
            fill: "forwards"
          }
        ).finished.catch(() => {}),
        drag.preview.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          {
            duration: 90,
            easing: "ease-out",
            fill: "forwards"
          }
        ).finished.catch(() => {})
      ];

      return Promise.all(settleAnimations);
    })
    .finally(() => {
      destinationItem.style.opacity = "";
      clearFavoriteDragState(drag);
    });
}

function syncFavoritesTitle() {
  state.favoritesTitle = normalizeFavoriteTitle(state.favoritesTitle);
  els.favoritesTitle.textContent = state.favoritesTitle;
  els.favoritesTitle.title = "雙擊可修改標題";
}

function isEditingFavoriteTitle() {
  return els.favoritesTitle.getAttribute("contenteditable") === "true";
}

function startFavoriteTitleEdit(options = {}) {
  if (isEditingFavoriteTitle()) return;

  const shouldClearTitleInput = Boolean(options.clearTitleInput);
  const isNewCollectionDraft = Boolean(options.isNewCollectionDraft);
  const shouldPreserveScroll = Boolean(options.preserveScroll);
  favoriteTitleBeforeEdit = shouldClearTitleInput ? "" : state.favoritesTitle;
  favoriteTitleEditContext = {
    ...options,
    clearTitleInput: shouldClearTitleInput,
    isNewCollectionDraft,
    preserveScroll: shouldPreserveScroll,
    scrollPosition: shouldPreserveScroll ? captureScrollPosition() : null
  };
  if (shouldClearTitleInput) {
    els.favoritesTitle.textContent = "";
  }
  els.favoritesTitle.setAttribute("contenteditable", "true");
  els.favoritesTitle.classList.add("is-editing");
  focusElementWithoutScroll(els.favoritesTitle);
  if (!shouldClearTitleInput) {
    selectElementText(els.favoritesTitle);
  }
}

function scrollToFavoritesTitleInput() {
  if (!(els.favoritesTitle instanceof Element)) return;
  if (typeof els.favoritesTitle.scrollIntoView === "function") {
    els.favoritesTitle.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    window.requestAnimationFrame(() => {
      window.scrollBy({
        top: -50,
        left: 0,
        behavior: "smooth"
      });
    });
  }
}

function focusElementWithoutScroll(element) {
  if (!(element instanceof Element)) return;

  const scrollTop = window.scrollY || window.pageYOffset;
  const scrollLeft = window.scrollX || window.pageXOffset;

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }

  requestAnimationFrame(() => {
    if (window.scrollY !== scrollTop || window.scrollX !== scrollLeft) {
      window.scrollTo({
        left: scrollLeft,
        top: scrollTop,
        behavior: "auto"
      });
    }
  });
}

function getDraftCancelMessage() {
  const draftAction = favoriteTitleEditContext?.draftAction;
  if (draftAction === "new") return "已取消新建收藏清單";
  if (draftAction === "duplicate") return "已取消複製收藏清單";
  return "已取消收藏清單";
}

function commitFavoriteTitleEdit() {
  const scrollPosition = favoriteTitleEditContext?.scrollPosition || null;
  const isEmptyInput = isFavoriteTitleInputEmpty();
  const isDraftCreation = Boolean(favoriteTitleEditContext?.isNewCollectionDraft);
  if (isDraftCreation && isEmptyInput) {
    const draftCollectionId = favoriteTitleEditContext?.newCollectionId;
    const shouldRemoveDraft = Boolean(draftCollectionId);

    endFavoriteTitleEdit();
    if (shouldRemoveDraft) {
      removeFavoriteCollectionById(draftCollectionId, {
        shouldScrollToResults: false
      });
      setFavoritesStatus(getDraftCancelMessage());
    } else {
      syncFavoritesTitle();
    }

    favoriteTitleEditContext = null;
    restoreScrollPosition(scrollPosition);
    return;
  }

  const nextTitle = normalizeFavoriteTitle(els.favoritesTitle.textContent);
  const changed = nextTitle !== state.favoritesTitle;

  const activeCollection = getActiveFavoriteCollection();
  if (activeCollection) activeCollection.title = nextTitle;
  state.favoritesTitle = nextTitle;
  endFavoriteTitleEdit();
  syncFavoritesTitle();
  saveFavorites();
  renderFavoriteCollections();

  if (changed) setFavoritesStatus("已更新收藏標題");
  favoriteTitleEditContext = null;
  restoreScrollPosition(scrollPosition);
}

function cancelFavoriteTitleEdit() {
  const scrollPosition = favoriteTitleEditContext?.scrollPosition || null;
  const isDraftCreation = Boolean(favoriteTitleEditContext?.isNewCollectionDraft);
  const isEmptyInput = isFavoriteTitleInputEmpty();
  const draftBaseTitle = normalizeFavoriteTitle(favoriteTitleEditContext?.draftBaseTitle);
  const isUnchangedDraft = isDraftCreation && !!draftBaseTitle && draftBaseTitle === normalizeFavoriteTitle(els.favoritesTitle.textContent || "");
  if (isDraftCreation && (isEmptyInput || isUnchangedDraft)) {
    const draftCollectionId = favoriteTitleEditContext?.newCollectionId;
    const shouldRemoveDraft = Boolean(draftCollectionId);

    endFavoriteTitleEdit();
    if (shouldRemoveDraft) {
      removeFavoriteCollectionById(draftCollectionId, {
        shouldScrollToResults: false
      });
      setFavoritesStatus(getDraftCancelMessage());
    } else {
      favoriteTitleBeforeEdit = favoriteTitleBeforeEdit ? normalizeFavoriteTitle(favoriteTitleBeforeEdit) : DEFAULT_FAVORITES_TITLE;
      syncFavoritesTitle();
    }

    favoriteTitleEditContext = null;
    restoreScrollPosition(scrollPosition);
    return;
  }

  state.favoritesTitle = favoriteTitleBeforeEdit;
  endFavoriteTitleEdit();
  syncFavoritesTitle();
  favoriteTitleEditContext = null;
  restoreScrollPosition(scrollPosition);
}

function endFavoriteTitleEdit() {
  els.favoritesTitle.removeAttribute("contenteditable");
  els.favoritesTitle.classList.remove("is-editing");
  els.favoritesTitle.blur();
  window.getSelection()?.removeAllRanges();
}

function isFavoriteTitleInputEmpty() {
  return !String(els.favoritesTitle.textContent || "").trim();
}

function selectElementText(element) {
  const range = document.createRange();
  range.selectNodeContents(element);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

async function shareFavoritesLink() {
  triggerShareButtonFeedback(els.shareFavorites);

  const url = buildFavoritesShareUrl();
  const favoriteTitle = normalizeFavoriteTitle(state.favoritesTitle);
  const shareText = `我在《成語星球》分享了一個「${favoriteTitle}」的精選成語給你`;

  if (!state.favorites.size) {
    setFavoritesStatus("目前沒有可分享的收藏");
    return;
  }

  try {
    const shareResult = await shareUrlToClipboardOrNative(url, {
      button: els.shareFavorites,
      title: `成語收藏 ${state.favoritesTitle}`,
      text: shareText
    });

    if (shareResult === "share") {
      setFavoritesStatus("已開啟分享功能");
    } else if (shareResult === "clipboard") {
      setFavoritesStatus("已複製收藏分享連結");
    } else if (shareResult === "prompt") {
      setFavoritesStatus("請手動複製分享連結");
    }
  } catch {
    window.prompt("複製收藏分享連結", url);
    setFavoritesStatus("請手動複製分享連結");
  }
}

function isLikelyMobileShareContext() {
  const isSmallScreen = window.matchMedia("(max-width: 767px)").matches;
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const userAgent = navigator.userAgent || "";
  const hasMobileUa = /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent);
  return isSmallScreen || isCoarsePointer || hasMobileUa;
}

function triggerShareButtonFeedback(button) {
  if (!(button instanceof Element)) return;

  const feedbackClass = "is-share-feedback";
  const previousTimer = shareFeedbackTimers.get(button);
  if (previousTimer) window.clearTimeout(previousTimer);

  button.classList.remove(feedbackClass);
  button.offsetWidth;
  button.classList.add(feedbackClass);

  const timer = window.setTimeout(() => {
    button.classList.remove(feedbackClass);
    shareFeedbackTimers.delete(button);
  }, 620);
  shareFeedbackTimers.set(button, timer);
}

async function shareUrlToClipboardOrNative(url, options = {}) {
  const title = options.title;
  const text = options.text;
  const shouldUseNativeShare = Boolean(options.useNativeShare ?? isLikelyMobileShareContext());

  if (shouldUseNativeShare && typeof navigator.share === "function") {
    try {
      await navigator.share({
        title,
        text,
        url
      });
      return "share";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return "clipboard";
  }

  return "prompt";
}

function buildFavoritesShareUrl() {
  const base = `${window.location.origin}${window.location.pathname}`;
  const fragment = buildFavoritesShareFragment();
  return `${base}#${fragment}`;
}

function buildFavoritesShareFragment() {
  const favoriteIds = [...state.favorites]
    .map(key => findIdiomByIdentifier(key))
    .filter(Boolean)
    .map(item => Number(item.編號))
    .filter(Number.isFinite)
    .map(id => id.toString(36));

  const params = new URLSearchParams();
  params.set("f", favoriteIds.join("."));

  if (state.favoritesTitle !== DEFAULT_FAVORITES_TITLE) {
    params.set("t", state.favoritesTitle);
  }

  return params.toString();
}

function applyFavoritesFromFragment() {
  const imported = parseFavoritesShareFragment(window.location.hash);
  if (!imported) return null;

  const resolved = applyFavoriteCollectionTitleFromFragment(imported.title, imported.favorites);
  let collectionId = resolved.collectionId;
  const isNewImport = Boolean(resolved.shouldImport);

  if (isNewImport) {
    collectionId = addFavoriteCollection({
      title: resolved.title,
      favorites: imported.favorites
    });
  }

  clearFavoriteShareHash();

  if (!collectionId) return null;
  switchFavoriteCollection(collectionId);
  renderFavoriteCollections();

  const statusPrefix = isNewImport
    ? "已載入分享收藏"
    : "分享內容已存在，已切換到原清單";
  const ignored = imported.ignoredCount ? `，略過 ${imported.ignoredCount} 筆無法辨識資料` : "";
  setFavoritesStatus(`${statusPrefix} ${imported.favorites.length} 筆${ignored}`.trim());
  return {
    collectionId,
    imported
  };
}

function parseFavoritesShareFragment(hash) {
  const fragment = String(hash || "").replace(/^#/, "");
  if (!fragment) return null;

  const params = new URLSearchParams(fragment);
  const encodedFavorites = params.get("f");
  if (!encodedFavorites) return null;

  const favorites = [];
  let ignoredCount = 0;

  encodedFavorites.split(".").forEach(value => {
    if (!value) return;

    const id = parseInt(value, 36);
    if (!Number.isFinite(id)) {
      ignoredCount += 1;
      return;
    }

    const item = findIdiomByIdentifier(String(id));
    if (!item) {
      ignoredCount += 1;
      return;
    }

    favorites.push(String(item.編號 || item.成語));
  });

  if (!favorites.length) return null;

  return {
    title: params.has("t") ? normalizeFavoriteTitle(params.get("t")) : null,
    favorites: [...new Set(favorites)],
    ignoredCount
  };
}

function exportFavorites() {
  const payload = buildFavoritesExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${safeFileName(state.favoritesTitle)}-${formatDateForFile(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  setFavoritesStatus(`已匯出 ${payload.favorites.length} 筆收藏`);
}

function buildFavoritesExportPayload() {
  return {
    schema: FAVORITES_EXPORT_SCHEMA,
    title: state.favoritesTitle,
    exportedAt: new Date().toISOString(),
    favorites: [...state.favorites].map(key => {
      const item = findIdiomByIdentifier(key);

      return {
        id: item ? String(item.編號 || item.成語) : key,
        idiom: item?.成語 || "",
        zhuyin: item?.注音 || "",
        pinyin: item?.漢語拼音 || ""
      };
    })
  };
}

async function importFavoritesFromFile(file) {
  try {
    const payload = JSON.parse(await file.text());
    const imported = parseFavoritesImport(payload);

    const activeCollection = getActiveFavoriteCollection();
    if (!activeCollection) return;

    if (imported.title !== null) activeCollection.title = imported.title;
    applyFavoriteCollectionFavorites(imported.favorites);
    state.favoritesTitle = activeCollection.title;
    saveFavorites();
    syncFavoritesTitle();
    renderFavorites();
    renderFavoriteCollections();
    els.input.value = "";
    state.query = "";
    renderFavoritesModeResults();

    const ignored = imported.ignoredCount ? `，略過 ${imported.ignoredCount} 筆無法辨識資料` : "";
    setFavoritesStatus(`已匯入 ${imported.favorites.length} 筆收藏${ignored}`);
  } catch (error) {
    console.error(error);
    setFavoritesStatus("匯入失敗");
    window.alert(error?.message || "匯入失敗，請確認 JSON 檔案格式。");
  }
}

function parseFavoritesImport(payload) {
  if (Array.isArray(payload)) return normalizeImportedFavorites(payload, null);

  if (!payload || typeof payload !== "object") {
    throw new Error("匯入檔必須是 JSON 物件或收藏陣列。");
  }

  const favorites = Array.isArray(payload.favorites)
    ? payload.favorites
    : Array.isArray(payload.items)
      ? payload.items
      : null;

  if (!favorites) throw new Error("匯入檔缺少 favorites 陣列。");

  const title = Object.prototype.hasOwnProperty.call(payload, "title")
    ? normalizeFavoriteTitle(payload.title)
    : null;

  return normalizeImportedFavorites(favorites, title);
}

function normalizeImportedFavorites(items, title) {
  const favorites = new Set();
  let ignoredCount = 0;

  items.forEach(item => {
    const key = resolveFavoriteImportKey(item);
    if (!key) {
      ignoredCount += 1;
      return;
    }

    favorites.add(key);
  });

  if (items.length > 0 && !favorites.size) {
    throw new Error("匯入檔沒有可辨識的收藏項目。");
  }

  return {
    title,
    favorites: [...favorites],
    ignoredCount
  };
}

function resolveFavoriteImportKey(value) {
  let identifier = "";
  let idiom = "";

  if (typeof value === "string" || typeof value === "number") {
    identifier = String(value).trim();
  } else if (value && typeof value === "object") {
    identifier = firstNonEmpty(value.id, value.key, value.編號, value.favoriteId);
    idiom = firstNonEmpty(value.idiom, value.成語, value.name);
  }

  if (!state.idioms.length) return identifier || idiom;

  const item = findIdiomByIdentifier(identifier) || findIdiomByIdentifier(idiom);
  return item ? String(item.編號 || item.成語) : "";
}

function firstNonEmpty(...values) {
  const value = values.find(item => String(item || "").trim());
  return value === undefined ? "" : String(value).trim();
}

function setFavoritesStatus(message) {
  window.clearTimeout(favoriteStatusTimer);
  els.favoritesStatus.textContent = message;

  if (message) {
    favoriteStatusTimer = window.setTimeout(() => {
      els.favoritesStatus.textContent = "";
    }, 3200);
  }
}

function setDailyCard() {
  const item = randomMainIdiom();
  if (!item) return;
  state.dailyItem = item;
  els.dailyIdiom.textContent = item.成語;
  setupPronunciationToggle(els.dailyPronunciation, buildDailyPronunciationItem(item), { primaryOnly: true });
  els.dailyMeaning.textContent = firstMeaning(item.釋義) || "今天先認識這一句，再把它放進生活裡。";
  els.dailyCard.setAttribute("tabindex", "0");
  els.dailyCard.setAttribute("role", "button");
  els.dailyCard.setAttribute("aria-label", `開啟今日成語卡：${item.成語}`);
}

function buildDailyPronunciationItem(item) {
  const firstZhuyin = getFirstPronunciation(item?.注音);
  const firstPinyin = getFirstPronunciation(item?.漢語拼音);

  return {
    ...item,
    注音: firstZhuyin || item?.注音,
    漢語拼音: firstPinyin || item?.漢語拼音
  };
}

function getFirstPronunciation(value) {
  const groups = splitPronunciationGroups(value);
  if (!groups.length) return "";
  return groups[0].syllables.join(" ");
}

function randomMainIdiom() {
  const mainIdioms = state.idioms.filter(item => item._main);
  return randomItem(mainIdioms.length ? mainIdioms : state.idioms);
}

function applySearchFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("q") || "";
  const filter = params.get("filter") || "main";
  const matchParam = (params.get("match") || "any").toLowerCase();
  const openId = params.get("id") || "";
  const page = Number.parseInt(params.get("page") || "1", 10);

  els.input.value = query;
  state.query = normalize(query);
  state.matchMode = ["exact", "prefix", "suffix", "any"].includes(matchParam) ? matchParam : "any";
  state.currentPage = Number.isFinite(page) && page > 0 ? page : 1;

  state.filter = ["all", "main", "phrase", "story", "quiz"].includes(filter) ? filter : "main";
  els.filters.forEach(item => item.classList.toggle("is-active", item.dataset.filter === state.filter));

  state.openId = openId;
}

function updateLocationFromState(openId, onlyOpenId = false, mode = "replace") {
  const params = new URLSearchParams();
  const q = els.input.value.trim();
  const totalPages = state.query ? getSearchTotalPages() : 1;

  if (q) params.set("q", q);
  if (state.matchMode && state.matchMode !== "any") params.set("match", state.matchMode);
  else params.delete("match");
  if (state.filter !== "main") params.set("filter", state.filter);
  if (state.query && totalPages > 1) params.set("page", String(state.currentPage));
  else params.delete("page");

  if (onlyOpenId) {
    if (openId && String(openId).length) params.set("id", String(openId));
  } else {
    params.delete("id");
  }

  const next = params.toString();
  const nextUrl = next ? `${window.location.pathname}?${next}` : window.location.pathname;
  if (nextUrl === `${window.location.pathname}${window.location.search}`) return;

  const method = mode === "push" ? "pushState" : "replaceState";
  window.history[method]({}, "", nextUrl);
}

function findIdiomByIdentifier(identifier) {
  const id = String(identifier || "").trim();
  if (!id) return null;
  return (
    state.idioms.find(item => String(item.編號 || "").trim() === id) ||
    state.idioms.find(item => String(item.成語).trim() === id)
  );
}

function buildStrokePracticeUrl(phrase) {
  const idiom = String(phrase || "").trim();
  return `https://stroke.gh.miniasp.com/?sentence=${encodeURIComponent(idiom)}`;
}

function buildIdiomShareUrl(item) {
  const id = String(item?.編號 || item?.成語 || "").trim();
  const params = new URLSearchParams();
  if (id) params.set("id", id);
  return `${window.location.origin}${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
}

function openRelatedIdiom(name) {
  const item = findIdiomByIdentifier(name);
  if (!item) return;

  els.input.value = item.成語;
  state.query = normalize(item.成語);
  renderResults([item]);
  openIdiomModal(item, true, "push");
}

function openIdiomModal(item, andUpdateUrl = true, historyMode = "replace") {
  if (!item) return;

  const id = String(item.編號 || item.成語);
  const sourceId = String(item.編號 || "").trim();
  const idiomForSearch = String(item.成語 || "").trim();
  state.openId = id;
  els.modalKind.textContent = item["主條成語／非主條成語"] || "成語條目";
  els.modalId.innerHTML = sourceId
    ? `編號 <a href="https://dict.idioms.moe.edu.tw/idiomList.jsp?idiom=${encodeURIComponent(idiomForSearch)}" target="_blank" rel="noopener">${escapeHtml(sourceId)}</a>`
    : "編號 未載明";
  els.modalTitle.textContent = item.成語 || "未命名成語";
  setupPronunciationToggle(els.modalPronunciation, item);

  const details = [
    usageContextBlock(item["用法說明-使用類別"]),
    meaningBlock(item["用法說明-語義說明"]),
    listBlock("用法例句", item["用法說明-例句"], 8, item.成語),
    block("典故說明", item.典故說明),
    listBlock("書證", item.書證, 10),
    sourceBlock(item),
    identificationBlock(item),
    idiomListBlock("近義", item.近義成語),
    idiomListBlock("反義", item.反義成語),
    idiomListBlock("參考詞語", item.參考詞語),
    identificationQuizBlock(item)
  ].filter(Boolean);

  els.modalContent.innerHTML = `
    <div class="modal__meaning">${renderMeaningParagraphs(item.釋義)}</div>
    <div class="modal__actions">
      <button class="button button--primary" id="favoriteInModal" type="button">${state.favorites.has(id) ? "已收藏" : "收藏"}</button>
      <button class="button button--secondary" id="writeWordInModal" type="button">去寫字</button>
      <button class="button button--secondary" id="shareInModal" type="button">分享</button>
    </div>
    <div class="modal__detail">${details.join("")}</div>
  `;

  const favoriteInModal = els.modalContent.querySelector("#favoriteInModal");
  const writeWordInModal = els.modalContent.querySelector("#writeWordInModal");
  const shareInModal = els.modalContent.querySelector("#shareInModal");
  const practiceUrl = buildStrokePracticeUrl(item.成語);
  const shareUrl = buildIdiomShareUrl(item);

  if (favoriteInModal) {
    favoriteInModal.addEventListener("click", () => {
      toggleFavorite(item);
      favoriteInModal.textContent = state.favorites.has(id) ? "已收藏" : "收藏";
    });
  }

  if (writeWordInModal) {
    writeWordInModal.title = `前往「${item.成語 || "未命名成語"}」寫字頁面`;
    writeWordInModal.addEventListener("click", () => {
      window.open(practiceUrl, "_blank", "noopener,noreferrer");
    });
  }

  if (shareInModal) {
    shareInModal.setAttribute("aria-live", "polite");
    shareInModal.addEventListener("click", async () => {
      triggerShareButtonFeedback(shareInModal);
      const originalText = "分享";
      shareInModal.disabled = true;

      try {
        const shareResult = await shareUrlToClipboardOrNative(shareUrl, {
          button: shareInModal,
          title: `${item.成語} - 成語分享`,
          text: `快看這個成語：${item.成語}`
        });

        if (shareResult === "share") {
          shareInModal.textContent = "已開啟分享";
        } else if (shareResult === "clipboard") {
          shareInModal.textContent = "已複製連結";
        } else if (shareResult === "prompt") {
          shareInModal.textContent = "請手動複製";
        } else {
          shareInModal.textContent = originalText;
        }
      } catch {
        window.prompt("複製成語分享連結", shareUrl);
        shareInModal.textContent = "請手動複製";
      }

      window.setTimeout(() => {
        shareInModal.textContent = originalText;
        shareInModal.disabled = false;
      }, 1600);
    });
  }

  bindIdentificationQuizEvents();

  els.modal.classList.remove("is-hidden");
  els.modal.setAttribute("aria-hidden", "false");

  if (andUpdateUrl) updateLocationFromState(id, true, historyMode);

  requestAnimationFrame(() => {
    if (favoriteInModal) favoriteInModal.focus();
  });
}

function hideIdiomModal() {
  state.openId = "";
  els.modal.classList.add("is-hidden");
  els.modal.setAttribute("aria-hidden", "true");
}

function closeIdiomModal() {
  hideIdiomModal();
  updateLocationFromState();
}

function syncFromLocation() {
  applySearchFromUrl();
  const sharedImport = applyFavoritesFromFragment();
  renderFavoriteCollections();
  const shouldShowSharedFavorites = Boolean(sharedImport);
  const nextResult = state.query ? searchIdioms() : (shouldShowSharedFavorites ? favoriteItems() : pickOpeningSet());

  renderResults(
    nextResult,
    shouldShowSharedFavorites
      ? {
          label: `顯示 ${nextResult.length} 筆收藏`,
          mode: "favorites"
        }
      : {}
  );

  if (!state.openId) {
    hideIdiomModal();
    return;
  }

  const target = findIdiomByIdentifier(state.openId);
  if (target) {
    openIdiomModal(target, false);
  } else {
    hideIdiomModal();
  }
}

async function loadData() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`資料載入失敗：${response.status}`);
  return response.json();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
  } catch (error) {
    console.warn("Service worker 註冊失敗", error);
  }
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u3000\s]+/g, " ")
    .trim()
    .toLowerCase();
}

function joinText(value) {
  if (Array.isArray(value)) return value.join(" ");
  return value || "";
}

function cleanText(value) {
  return String(value || "")
    .replace(/[#*]\d*\*?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSourceTitle(value) {
  return String(value || "")
    .replace(/^※＃/, "")
    .replace(/^＃+/, "")
    .replace(/^#+/, "")
    .replace(/\*\d+\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceParagraphs(value) {
  const text = (Array.isArray(value) ? value.join("") : String(value || ""))
    .split(/[#◎]/)
    .map(paragraph => paragraph.replace(/\*\d+\*/g, "").replace(/\s+/g, "").trim())
    .filter(Boolean);

  return text;
}

function firstMeaning(value) {
  return meaningParagraphs(value)[0] || "";
}

function meaningParagraphs(value) {
  const text = Array.isArray(value)
    ? value.filter(item => !String(item || "").trim().startsWith("△")).join(" ")
    : String(value || "");

  return text
    .split(/[＃◎※]/)
    .map(cleanText)
    .filter(Boolean);
}

function renderMeaningParagraphs(value) {
  const paragraphs = meaningParagraphs(value);
  if (!paragraphs.length) return `<p>此條目未提供釋義。</p>`;
  return paragraphs.map(paragraph => `<p>${renderLinkedText(paragraph)}</p>`).join("");
}

function compactText(value) {
  return cleanText(value).slice(0, 28);
}

function splitIdiomList(value) {
  return cleanText(joinText(value))
    .split("、")
    .map(item => item.trim())
    .filter(Boolean);
}

function splitUsageContexts(value) {
  return splitAmpersandList(value);
}

function splitAmpersandList(value) {
  return uniqueItems(cleanText(joinText(value))
    .split("＆")
    .map(item => item.trim())
    .filter(Boolean));
}

function hasMeaningfulText(value) {
  return /[\p{Script=Han}\p{Script=Bopomofo}\p{Letter}\p{Number}]/u.test(String(value || ""));
}

function uniqueItems(items, keyFn = item => item) {
  const seen = new Set();
  return items.filter(item => {
    const key = cleanText(keyFn(item));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceContentKey(value) {
  return cleanText(value).replace(/^\d\d\.\s*/, "");
}

function renderLinkedText(text, highlightTerm = "") {
  const value = String(text || "");
  const pattern = /「([^」]{2,12})」/g;
  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(value))) {
    const [quoted, name] = match;
    html += renderHighlightedPlainText(value.slice(lastIndex, match.index), highlightTerm);

    if (state.idiomByName.has(name)) {
      const highlightClass = name === highlightTerm ? " is-highlighted" : "";
      html += `「<button class="related-idiom-link${highlightClass}" type="button" data-related-idiom="${escapeHtml(name)}">${escapeHtml(name)}</button>」`;
    } else {
      html += renderHighlightedPlainText(quoted, highlightTerm);
    }

    lastIndex = match.index + quoted.length;
  }

  html += renderHighlightedPlainText(value.slice(lastIndex), highlightTerm);
  return html;
}

function renderHighlightedPlainText(text, highlightTerm = "") {
  const value = String(text || "");
  const term = String(highlightTerm || "").trim();
  if (!term) return escapeHtml(value);

  let html = "";
  let start = 0;
  let index = value.indexOf(term);

  while (index !== -1) {
    html += escapeHtml(value.slice(start, index));
    html += `<mark class="example-highlight">${escapeHtml(term)}</mark>`;
    start = index + term.length;
    index = value.indexOf(term, start);
  }

  html += escapeHtml(value.slice(start));
  return html;
}

function setupPronunciationToggle(button, item, options = {}) {
  const itemId = String(item?.編號 || "").trim();
  const zhuyin = normalizePronunciationValue(itemId, item?.注音, "zhuyin");
  const pinyin = normalizePronunciationValue(itemId, item?.漢語拼音, "pinyin");
  const hasBoth = Boolean(zhuyin && pinyin);
  const pronunciationLabelMode = itemId === "413" ? "preserve" : "standard";
  button._pronunciation = {
    zhuyin,
    pinyin,
    hasBoth,
    primaryOnly: Boolean(options.primaryOnly),
    pronunciationLabelMode
  };

  button.onclick = event => {
    event.stopPropagation();
    if (!hasBoth) return;
    setPronunciationMode(currentPronunciationMode(button) === "zhuyin" ? "pinyin" : "zhuyin");
  };

  renderPronunciationButton(button);
}

function normalizePronunciationValue(id, value, field) {
  const text = cleanText(value);
  if (String(id || "") !== "413") return text;
  if (field !== "zhuyin" && field !== "pinyin") return text;
  return text
    .replace(/([^\s（])(?=(（[一二三四五六七八九十]+）))/gu, "$1 ")
    .replace(/（[一二三四五六七八九十]+）(?=[^\s（])/gu, "$& ");
}

function renderZhuyinSyllables(value) {
  return renderPronunciationSyllables(value);
}

function renderPronunciationSyllables(value, options = {}) {
  const groups = splitPronunciationGroups(value);
  const visibleGroups = options.primaryOnly ? groups.slice(0, 1) : groups;
  const hasVariants = !options.primaryOnly && (groups.length > 1 || groups.some(group => group.label));
  const shouldRenderToneAsSup = options.renderToneAsSup || isBopomofoText(value);

  return visibleGroups.map((group, index) => {
    const syllables = group.syllables
      .map(syllable => `<span class="pronunciation__syllable">${renderPronunciationSyllable(syllable, shouldRenderToneAsSup)}</span>`)
      .join("");
    const labelText = options.primaryOnly ? "" : pronunciationGroupLabel(
      group.label,
      index,
      hasVariants,
      options.pronunciationLabelMode
    );
    const label = labelText ? `<span class="pronunciation__variant-label">${escapeHtml(labelText)}</span>` : "";

    return `<span class="pronunciation__group">${label}${syllables}</span>`;
  }).join("");
}

function isBopomofoText(value) {
  return /[\u3100-\u312F\u31A0-\u31BA]/.test(String(value || ""));
}

function renderPronunciationSyllable(syllable, shouldRenderToneAsSup) {
  if (!shouldRenderToneAsSup) return escapeHtml(syllable);
  const toneRegex = /[\u02C9\u02CA\u02C7\u02CB\u02D9\u00B7]/;

  return String(syllable || "")
    .split("")
    .map(char => {
      if (toneRegex.test(char)) return `<sup>${escapeHtml(char)}</sup>`;
      return escapeHtml(char);
    })
    .join("");
}

function pronunciationGroupLabel(label, index, hasVariants, mode = "standard") {
  if (mode === "preserve") return label || "";
  if (label.includes("變")) return "變讀";
  if (hasVariants && index === 0) return "本音";
  return label.replace(/[（）]/g, "");
}

function splitPronunciationGroups(value) {
  const tokens = cleanText(value).split(/\s+/).filter(Boolean);
  const groups = [];
  let current = { label: "", syllables: [] };

  tokens.forEach(token => {
    if (/^（[^）]+）$/.test(token)) {
      if (current.syllables.length) groups.push(current);
      current = { label: token, syllables: [] };
      return;
    }

    current.syllables.push(token);
  });

  if (current.syllables.length || current.label) groups.push(current);
  return groups;
}

function currentPronunciationMode(button) {
  const data = button._pronunciation || {};
  if (state.pronunciationMode === "pinyin" && data.pinyin) return "pinyin";
  if (data.zhuyin) return "zhuyin";
  return "pinyin";
}

function renderPronunciationButton(button) {
  const data = button._pronunciation || {};
  const mode = currentPronunciationMode(button);
  const label = mode === "zhuyin" ? "注音" : "拼音";
  const text = mode === "zhuyin" ? data.zhuyin : data.pinyin;

  button.classList.toggle("is-zhuyin", mode === "zhuyin");
  button.classList.toggle("is-pinyin", mode === "pinyin");
  button.innerHTML = renderPronunciationSyllables(text, {
    primaryOnly: data.primaryOnly,
    renderToneAsSup: mode === "zhuyin",
    pronunciationLabelMode: data.pronunciationLabelMode || "standard"
  });
  button.disabled = !data.hasBoth;
  button.setAttribute("aria-label", data.hasBoth ? `${label}，點擊切換${mode === "zhuyin" ? "拼音" : "注音"}` : label);
}

function setPronunciationMode(mode) {
  state.pronunciationMode = mode === "pinyin" ? "pinyin" : "zhuyin";
  savePronunciationMode();
  document.querySelectorAll(".pronunciation").forEach(renderPronunciationButton);
}

function randomItem(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function readFavoritesSettings() {
  const fallbackCollections = [{
    id: DEFAULT_FAVORITE_COLLECTION_ID,
    title: DEFAULT_FAVORITES_TITLE,
    favorites: []
  }];

  const fallback = {
    collections: fallbackCollections,
    activeCollectionId: DEFAULT_FAVORITE_COLLECTION_ID,
    favorites: fallbackCollections[0].favorites,
    title: fallbackCollections[0].title
  };

  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return fallback;

    const payload = JSON.parse(raw);
    let collections = [];

    if (Array.isArray(payload)) {
      collections = [
        normalizeFavoriteCollection({
          id: DEFAULT_FAVORITE_COLLECTION_ID,
          title: DEFAULT_FAVORITES_TITLE,
          favorites: payload
        }, 0)
      ];
    } else if (payload && typeof payload === "object" && Array.isArray(payload.collections)) {
      collections = payload.collections
        .map((item, index) => normalizeFavoriteCollection(item, index))
        .filter(Boolean);

      if (!collections.some(item => item.id === DEFAULT_FAVORITE_COLLECTION_ID)) {
        collections.unshift(normalizeFavoriteCollection({
          id: DEFAULT_FAVORITE_COLLECTION_ID,
          title: payload.title,
          favorites: payload.favorites || payload.items
        }, 0));
      }

      if (!collections.length) {
        collections = fallbackCollections.map(item => ({ ...item }));
      }
    } else if (payload && typeof payload === "object") {
      collections = [
        normalizeFavoriteCollection({
          id: DEFAULT_FAVORITE_COLLECTION_ID,
          title: payload.title,
          favorites: payload.favorites || payload.items
        }, 0)
      ];
    } else {
      return fallback;
    }

    const activeCollectionId = validateFavoriteCollectionId(payload?.activeCollectionId || "", collections);
    const activeCollection = getFavoriteCollectionByIdFromList(activeCollectionId, collections) || collections[0];

    return {
      collections,
      activeCollectionId: activeCollection.id,
      favorites: activeCollection.favorites,
      title: activeCollection.title
    };
  } catch {
    return fallback;
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify({
      collections: state.favoriteCollections,
      activeCollectionId: state.activeFavoriteCollectionId
    }));
  } catch {}
}

function getFavoriteCollectionByIdFromList(collectionId, collections) {
  return collections.find(item => item.id === collectionId) || null;
}

function validateFavoriteCollectionId(collectionId, collections) {
  if (getFavoriteCollectionByIdFromList(collectionId, collections)) return collectionId;
  return collections.find(item => item.id === DEFAULT_FAVORITE_COLLECTION_ID)?.id || collections[0]?.id || DEFAULT_FAVORITE_COLLECTION_ID;
}

function normalizeFavoriteTitle(value) {
  const title = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  return title ? title.slice(0, 32) : DEFAULT_FAVORITES_TITLE;
}

function normalizeStoredFavoriteKeys(items) {
  if (!Array.isArray(items)) return [];

  return [...new Set(items.map(extractStoredFavoriteKey).filter(Boolean))];
}

function extractStoredFavoriteKey(item) {
  if (typeof item === "string" || typeof item === "number") return String(item).trim();

  if (item && typeof item === "object") {
    return firstNonEmpty(item.id, item.key, item.編號, item.idiom, item.成語);
  }

  return "";
}

function safeFileName(value) {
  return normalizeFavoriteTitle(value)
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 48) || "favorites";
}

function formatDateForFile(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

function readPronunciationMode() {
  try {
    return localStorage.getItem(PRONUNCIATION_MODE_KEY) === "pinyin" ? "pinyin" : "zhuyin";
  } catch {
    return "zhuyin";
  }
}

function savePronunciationMode() {
  try {
    localStorage.setItem(PRONUNCIATION_MODE_KEY, state.pronunciationMode);
  } catch {}
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

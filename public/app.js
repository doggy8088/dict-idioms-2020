const DATA_URL = "dict_idioms_2020_20260324.min.json";
const MAX_RESULTS = 24;
const FAVORITES_KEY = "dict-idioms-favorites";
const PRONUNCIATION_MODE_KEY = "dict-idioms-pronunciation-mode";
const DEFAULT_OPEN_COUNT = 6;

const state = {
  idioms: [],
  idiomByName: new Map(),
  query: "",
  filter: "all",
  openId: "",
  pronunciationMode: readPronunciationMode(),
  dailyItem: null,
  favorites: new Set(readFavorites())
};

const els = {
  dataStatus: document.querySelector("#dataStatus"),
  dailyCard: document.querySelector(".memory-card"),
  dailyIdiom: document.querySelector("#dailyIdiom"),
  dailyMeaning: document.querySelector("#dailyMeaning"),
  form: document.querySelector("#searchForm"),
  input: document.querySelector("#queryInput"),
  filters: document.querySelectorAll(".filter"),
  quickPicks: document.querySelectorAll(".quick-picks button"),
  results: document.querySelector("#results"),
  resultCount: document.querySelector("#resultCount"),
  template: document.querySelector("#idiomTemplate"),
  randomTop: document.querySelector("#randomTop"),
  favoritesList: document.querySelector("#favoritesList"),
  clearFavorites: document.querySelector("#clearFavorites"),
  modal: document.querySelector("#idiomModal"),
  modalKind: document.querySelector("#idiomModalKind"),
  modalTitle: document.querySelector("#idiomModalTitle"),
  modalPronunciation: document.querySelector("#idiomModalPronunciation"),
  modalContent: document.querySelector("#idiomModalContent"),
  modalClose: document.querySelector("#idiomModalClose")
};

init();

async function init() {
  applySearchFromUrl();
  bindEvents();
  await registerServiceWorker();

  try {
    const payload = await loadData();
    if (!payload) throw new Error("資料載入失敗");

    state.idioms = Array.isArray(payload) ? payload : payload.idioms || [];
    state.idioms = state.idioms.map(prepareIdiom);
    state.idiomByName = new Map(state.idioms.map(item => [String(item.成語 || "").trim(), item]).filter(([name]) => name));

    els.dataStatus.textContent = `已載入 ${state.idioms.length.toLocaleString("zh-TW")} 筆成語`;
    setDailyCard();
    renderFavorites();

    const initialResult = state.query ? searchIdioms() : pickOpeningSet();
    renderResults(initialResult);

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
    renderResults(searchIdioms());
    updateLocationFromState();
    els.results.focus({ preventScroll: true });
  });

  els.input.addEventListener("input", () => {
    state.query = normalize(els.input.value);
    renderResults(searchIdioms());
    updateLocationFromState();
  });

  els.filters.forEach(button => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      els.filters.forEach(item => item.classList.toggle("is-active", item === button));
      renderResults(searchIdioms());
      updateLocationFromState();
    });
  });

  els.quickPicks.forEach(button => {
    button.addEventListener("click", () => {
      els.input.value = button.dataset.query;
      state.query = normalize(button.dataset.query);
      renderResults(searchIdioms());
      updateLocationFromState();
      els.input.focus();
    });
  });

  els.randomTop.addEventListener("click", () => {
    const item = randomMainIdiom();
    if (!item) return;
    els.input.value = item.成語;
    state.query = normalize(item.成語);
    renderResults([item]);
    openIdiomModal(item);
    document.querySelector("#results-title").scrollIntoView({ behavior: "smooth", block: "start" });
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

  els.clearFavorites.addEventListener("click", () => {
    state.favorites.clear();
    saveFavorites();
    renderFavorites();
    renderResults(searchIdioms());
  });

  els.modalClose.addEventListener("click", closeIdiomModal);
  els.modal.querySelector("[data-close-modal]").addEventListener("click", closeIdiomModal);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !els.modal.classList.contains("is-hidden")) {
      closeIdiomModal();
    }
  });

  document.addEventListener("click", event => {
    const link = event.target.closest("[data-related-idiom]");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    openRelatedIdiom(link.dataset.relatedIdiom);
  });

  window.addEventListener("popstate", syncFromLocation);
}

function prepareIdiom(item) {
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
    _main: item["主條成語／非主條成語"] === "主條成語"
  };
}

function searchIdioms() {
  let items = state.idioms;

  if (state.filter === "main") items = items.filter(item => item._main);
  if (state.filter === "phrase") items = items.filter(item => item.參考詞語);
  if (state.filter === "story") items = items.filter(item => item.典故說明);

  if (!state.query) return pickOpeningSet(items);

  const tokens = state.query.split(/\s+/).filter(Boolean);
  return items
    .map(item => ({ item, score: scoreItem(item, tokens) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.item.編號) - Number(b.item.編號))
    .slice(0, MAX_RESULTS)
    .map(entry => entry.item);
}

function scoreItem(item, tokens) {
  let score = 0;
  for (const token of tokens) {
    if (!item._search.includes(token)) return 0;
    if (normalize(item.成語) === token) score += 120;
    else if (normalize(item.成語).includes(token)) score += 80;
    if (normalize(item.漢語拼音 || "").includes(token)) score += 36;
    if (normalize(item.注音 || "").includes(token)) score += 32;
    if (normalize(joinText(item.釋義)).includes(token)) score += 26;
    if (normalize(joinText(item["用法說明-例句"])).includes(token)) score += 18;
    score += Math.max(1, 14 - Math.floor(item._search.indexOf(token) / 160));
  }
  if (item._main) score += 8;
  return score;
}

function pickOpeningSet(items = state.idioms) {
  const list = [...items];
  const shuffled = shuffle(list);
  return shuffled.slice(0, Math.min(DEFAULT_OPEN_COUNT, shuffled.length));
}

function renderResults(items) {
  els.results.innerHTML = "";

  if (!items.length) {
    els.resultCount.textContent = "找不到符合的成語";
    els.results.innerHTML = `<p class="empty-state">沒有找到符合條件的成語。可以改用更短的詞，例如「勇敢」、「朋友」或「吝嗇」。</p>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => fragment.appendChild(createCard(item, index)));
  els.results.appendChild(fragment);

  const label = state.query ? `顯示 ${items.length} 筆結果` : `先放上 ${items.length} 張推薦卡`;
  els.resultCount.textContent = label;
}

function createCard(item, index) {
  const card = els.template.content.firstElementChild.cloneNode(true);
  card.style.animationDelay = `${Math.min(index * 35, 420)}ms`;
  card.querySelector(".idiom-card__number").textContent = `編號 ${item.編號 || "未載明"}`;
  card.querySelector("h3").textContent = item.成語 || "未命名成語";
  setupPronunciationToggle(card.querySelector(".pronunciation"), item);
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
    if (event.target.closest("button,details,summary,.favorite-button")) return;
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
  renderDetails(card.querySelector(".detail-body"), item);
  return card;
}

function renderTags(container, item) {
  const tags = [
    item["主條成語／非主條成語"],
    item["用法說明-使用類別"],
    item.近義成語 ? `近義：${compactText(item.近義成語)}` : "",
    item.反義成語 ? `反義：${compactText(item.反義成語)}` : ""
  ].filter(Boolean).slice(0, 4);

  container.innerHTML = tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
}

function renderDetails(container, item) {
  const blocks = [
    block("語義說明", item["用法說明-語義說明"]),
    block("典故說明", item.典故說明),
    listBlock("用法例句", item["用法說明-例句"], 4),
    listBlock("書證", item.書證, 3),
    block("典源", [item.典源文獻名稱, joinText(item.典源文獻內容)].filter(Boolean).join("：")),
    block("辨識", [item["辨識-同"], item["辨識-異"], joinText(item["辨識-例句"])].filter(Boolean).join(" ")),
    block("參考詞語", item.參考詞語)
  ].filter(Boolean);

  container.innerHTML = blocks.join("") || `<p class="empty-state">此條目沒有更多補充內容。</p>`;
}

function block(title, value) {
  const text = cleanText(joinText(value));
  if (!text) return "";
  return `<section class="detail-block"><h4>${escapeHtml(title)}</h4><p>${renderLinkedText(text)}</p></section>`;
}

function listBlock(title, values, limit) {
  const items = Array.isArray(values) ? values.map(cleanText).filter(Boolean).slice(0, limit) : [];
  if (!items.length) return "";
  return `<section class="detail-block"><h4>${escapeHtml(title)}</h4><ul>${items.map(item => `<li>${renderLinkedText(item)}</li>`).join("")}</ul></section>`;
}

function toggleFavorite(item) {
  const key = String(item.編號 || item.成語);
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.add(key);
  saveFavorites();
  renderFavorites();
  renderResults(searchIdioms());
}

function renderFavorites() {
  const saved = [...state.favorites]
    .map(key => state.idioms.find(item => String(item.編號 || item.成語) === key))
    .filter(Boolean);

  if (!saved.length) {
    els.favoritesList.innerHTML = `<p class="empty-state">還沒有收藏。遇到喜歡的成語，就把它放進自己的小書籤。</p>`;
    return;
  }

  els.favoritesList.innerHTML = saved.map(item => `<button type="button" data-id="${escapeHtml(String(item.編號 || item.成語))}">${escapeHtml(item.成語)}</button>`).join("");
  els.favoritesList.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      const item = saved.find(entry => String(entry.編號 || entry.成語) === button.dataset.id);
      if (!item) return;
      els.input.value = item.成語;
      state.query = normalize(item.成語);
      renderResults([item]);
      updateLocationFromState(item.編號 || item.成語, true);
    });
  });
}

function setDailyCard() {
  const item = randomMainIdiom();
  if (!item) return;
  state.dailyItem = item;
  els.dailyIdiom.textContent = item.成語;
  els.dailyMeaning.textContent = firstMeaning(item.釋義) || "今天先認識這一句，再把它放進生活裡。";
  els.dailyCard.setAttribute("tabindex", "0");
  els.dailyCard.setAttribute("role", "button");
  els.dailyCard.setAttribute("aria-label", `開啟今日成語卡：${item.成語}`);
}

function randomMainIdiom() {
  const mainIdioms = state.idioms.filter(item => item._main);
  return randomItem(mainIdioms.length ? mainIdioms : state.idioms);
}

function applySearchFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("q") || "";
  const filter = params.get("filter") || "all";
  const openId = params.get("id") || "";

  els.input.value = query;
  state.query = normalize(query);

  state.filter = ["all", "main", "phrase", "story"].includes(filter) ? filter : "all";
  els.filters.forEach(item => item.classList.toggle("is-active", item.dataset.filter === state.filter));

  state.openId = openId;
}

function updateLocationFromState(openId, onlyOpenId = false, mode = "replace") {
  const params = new URLSearchParams();
  const q = els.input.value.trim();

  if (q) params.set("q", q);
  if (state.filter !== "all") params.set("filter", state.filter);

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
  state.openId = id;
  els.modalKind.textContent = item["主條成語／非主條成語"] || "成語條目";
  els.modalTitle.textContent = item.成語 || "未命名成語";
  setupPronunciationToggle(els.modalPronunciation, item);

  const details = [
    block("語義說明", item["用法說明-語義說明"]),
    block("典故說明", item.典故說明),
    listBlock("用法例句", item["用法說明-例句"], 8),
    listBlock("書證", item.書證, 10),
    block("典源", [item.典源文獻名稱, joinText(item.典源文獻內容)].filter(Boolean).join("：")),
    block("辨識", [item["辨識-同"], item["辨識-異"], joinText(item["辨識-例句"])].filter(Boolean).join(" ")),
    block("近義", item.近義成語),
    block("反義", item.反義成語),
    block("參考詞語", item.參考詞語)
  ].filter(Boolean);

  const tags = [
    item["主條成語／非主條成語"],
    item["用法說明-使用類別"],
    item.近義成語 ? `近義：${compactText(item.近義成語)}` : "",
    item.反義成語 ? `反義：${compactText(item.反義成語)}` : ""
  ].filter(Boolean).slice(0, 4).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("");

  els.modalContent.innerHTML = `
    <p class="modal__id">編號 ${item.編號 || "未載明"}</p>
    <p class="modal__meaning">${renderLinkedText(firstMeaning(item.釋義) || "此條目未提供釋義。")}</p>
    <div class="modal__tags">${tags}</div>
    <div class="modal__actions">
      <button class="button button--primary" id="favoriteInModal" type="button">${state.favorites.has(id) ? "已收藏" : "收藏"}</button>
      <button class="button button--secondary" id="shareInModal" type="button">複製分享連結</button>
    </div>
    <div class="modal__detail">${details.join("")}</div>
  `;

  const favoriteInModal = els.modalContent.querySelector("#favoriteInModal");
  const shareInModal = els.modalContent.querySelector("#shareInModal");

  if (favoriteInModal) {
    favoriteInModal.addEventListener("click", () => {
      toggleFavorite(item);
      favoriteInModal.textContent = state.favorites.has(id) ? "已收藏" : "收藏";
    });
  }

  if (shareInModal) {
    shareInModal.setAttribute("aria-live", "polite");
    shareInModal.addEventListener("click", async () => {
      const originalText = "複製分享連結";
      shareInModal.disabled = true;

      try {
        await navigator.clipboard?.writeText(window.location.href);
        shareInModal.textContent = "已複製";
      } catch {
        shareInModal.textContent = "複製失敗";
      }

      window.setTimeout(() => {
        shareInModal.textContent = originalText;
        shareInModal.disabled = false;
      }, 1600);
    });
  }

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
  renderResults(state.query ? searchIdioms() : pickOpeningSet());

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

function firstMeaning(value) {
  const list = Array.isArray(value) ? value : [value];
  return cleanText(list.find(Boolean) || "");
}

function compactText(value) {
  return cleanText(value).slice(0, 28);
}

function renderLinkedText(text) {
  const value = String(text || "");
  const pattern = /「([^」]{2,12})」/g;
  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(value))) {
    const [quoted, name] = match;
    html += escapeHtml(value.slice(lastIndex, match.index));

    if (state.idiomByName.has(name)) {
      html += `「<button class="related-idiom-link" type="button" data-related-idiom="${escapeHtml(name)}">${escapeHtml(name)}</button>」`;
    } else {
      html += escapeHtml(quoted);
    }

    lastIndex = match.index + quoted.length;
  }

  html += escapeHtml(value.slice(lastIndex));
  return html;
}

function setupPronunciationToggle(button, item) {
  const zhuyin = cleanText(item.注音);
  const pinyin = cleanText(item.漢語拼音);
  const hasBoth = Boolean(zhuyin && pinyin);
  button._pronunciation = { zhuyin, pinyin, hasBoth };

  button.onclick = event => {
    event.stopPropagation();
    if (!hasBoth) return;
    setPronunciationMode(currentPronunciationMode(button) === "zhuyin" ? "pinyin" : "zhuyin");
  };

  renderPronunciationButton(button);
}

function renderZhuyinSyllables(value) {
  return renderPronunciationSyllables(value);
}

function renderPronunciationSyllables(value) {
  return cleanText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(syllable => `<span class="pronunciation__syllable">${escapeHtml(syllable)}</span>`)
    .join("");
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
  button.innerHTML = renderPronunciationSyllables(text);
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

function readFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
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

const DATA_URL = "dict_idioms_2020_20260324.min.json";
const LIST_STORAGE_KEY = "dict-idioms-playlist-collections-v1";
const SHARE_IDS_PARAM = "i";
const SHARE_HASH_IDS_PARAM = "f";
const SHARE_TITLE_PARAM = "t";
const SHARE_DEFAULT_NAME = "我的成語收藏";
const LIST_NAME_MAX = 32;

const state = {
  idioms: [],
  idiomByName: new Map(),
  idiomById: new Map(),
  lists: [],
  activeListId: "",
  draft: {
    name: "",
    rawLines: "",
    rows: [],
    validIds: []
  }
};

const els = {
  dataStatus: document.querySelector("#dataStatus"),
  listName: document.querySelector("#listName"),
  idiomLines: document.querySelector("#idiomLines"),
  randomIdioms: document.querySelector("#randomIdioms"),
  validationSummary: document.querySelector("#validationSummary"),
  validationList: document.querySelector("#validationList"),
  saveList: document.querySelector("#saveList"),
  newList: document.querySelector("#newList"),
  clearForm: document.querySelector("#clearForm"),
  shareUrl: document.querySelector("#shareUrl"),
  shareMessage: document.querySelector("#shareMessage"),
  copyShareUrl: document.querySelector("#copyShareUrl"),
  copyShareMessage: document.querySelector("#copyShareMessage"),
  openShare: document.querySelector("#openShare"),
  listContainer: document.querySelector("#listContainer"),
  listStatus: document.querySelector("#listStatus"),
  savedCount: document.querySelector("#savedCount"),
  idiomCount: document.querySelector("#idiomCount"),
  editorTitle: document.querySelector("#editor-title"),
  createSavedList: document.querySelector("#createSavedList"),
  editorHint: document.querySelector("#editorHint")
};

init();

async function init() {
  try {
    const data = await loadData();
    state.idioms = normalizeIdioms(Array.isArray(data) ? data : data.idioms || []);
    state.idiomByName = buildIdiomLookupByName(state.idioms);
    state.idiomById = buildIdiomLookupById(state.idioms);
    els.dataStatus.textContent = `已載入 ${state.idioms.length.toLocaleString("zh-TW")} 筆成語`;
  } catch (error) {
    els.dataStatus.textContent = "資料載入失敗，請確認成語檔案是否存在。";
    setStatus("資料載入失敗，請稍後再試。");
    return;
  }

  state.lists = readListsFromStorage();
  if (state.activeListId && !getListById(state.activeListId)) {
    state.activeListId = "";
  }
  bindEvents();
  renderSavedLists();

  const sharedFromUrl = getSharedPayloadFromUrl();
  if (sharedFromUrl) {
    importSharedList(sharedFromUrl);
    setStatus(`已從分享網址載入清單「${sharedFromUrl.name}」`);
  }

  if (!state.activeListId && state.lists.length > 0) {
    state.activeListId = state.lists[0].id;
  }

  if (state.activeListId) {
    applyListToForm(state.activeListId);
  } else {
    clearDraftForm();
    setShareOutputDisabled();
  }
}

function bindEvents() {
  els.listName.addEventListener("input", () => {
    updateListNameInputState();
    updateDraftFromInputs();
  });

  els.listName.addEventListener("blur", () => {
    updateListNameInputState();
  });

  els.idiomLines.addEventListener("input", () => {
    updateDraftFromInputs();
  });

  els.randomIdioms.addEventListener("click", () => {
    applyRandomIdiomsToInput();
  });

  els.saveList.addEventListener("click", () => {
    saveCurrentList();
  });

  els.newList.addEventListener("click", () => {
    saveAsNewList();
  });

  els.clearForm.addEventListener("click", () => {
    clearDraftForm();
  });

  els.createSavedList.addEventListener("click", () => {
    startNewDraft();
  });

  els.copyShareUrl.addEventListener("click", () => {
    copyTextToClipboard(els.shareUrl.value, "網址");
  });

  els.shareUrl.addEventListener("click", () => {
    copyShareFieldContent(els.shareUrl, "網址");
  });

  els.copyShareMessage.addEventListener("click", () => {
    copyTextToClipboard(els.shareMessage.value, "訊息");
  });

  els.shareMessage.addEventListener("click", () => {
    copyShareFieldContent(els.shareMessage, "訊息");
  });

  els.openShare.addEventListener("click", event => {
    if (els.openShare.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
    }
  });

  els.listContainer.addEventListener("click", event => {
    const action = event.target?.closest("[data-action]")?.dataset.action;
    if (!action) return;

    const row = event.target.closest("[data-list-id]");
    const listId = row?.dataset.listId || "";
    if (!listId) return;

    if (action === "open") applyListToForm(listId);
    if (action === "delete") deleteList(listId);
    if (action === "copy") copyListShare(listId);
  });

  window.addEventListener("popstate", () => {
    const shared = getSharedPayloadFromUrl();
    if (!shared) return;
    importSharedList(shared);
  });
}

function updateDraftFromInputs() {
  updateListNameInputState();

  const name = sanitizeListName(els.listName.value);
  const raw = els.idiomLines.value;
  const parsed = parseIdiomLines(raw);

  state.draft.name = name;
  state.draft.rawLines = raw;
  state.draft.rows = parsed.rows;
  state.draft.validIds = parsed.validIds;
  updateIdiomCountHint(state.draft.validIds.length);

  if (!raw.trim()) {
    els.validationSummary.textContent = "請輸入至少一筆成語，並在每行只放一個成語。";
    els.validationList.innerHTML = "";
    setShareOutputDisabled();
    updateDraftHint();
    return;
  }

  els.validationSummary.textContent = `本次輸入共 ${parsed.rows.length} 行，${parsed.validIds.length} 筆可用，${parsed.missingCount} 筆未找到`;
  if (parsed.duplicateCount) {
    els.validationSummary.textContent += `，${parsed.duplicateCount} 筆重複已略過`;
  }

  els.validationList.innerHTML = parsed.rows
    .map(row => {
      const lineLabel = `第 ${row.line} 行`;
      const statusText = row.status === "valid"
        ? "已找到"
        : row.status === "duplicate"
          ? "重複"
          : "未找到";
      return `<p class="validation-item ${row.status}"><span>${lineLabel}</span><strong>${escapeHtml(row.text)}</strong><em>${statusText}</em></p>`;
    })
    .join("");

  updateDraftHint();
  maybeUpdateShareOutput();
  setShareOutputDisabled(state.draft.validIds.length === 0);
}

function updateDraftHint() {
  const listName = sanitizeListName(state.draft.name);
  if (state.activeListId) {
    const activeName = sanitizeListName((getListById(state.activeListId) || {}).name);
    const title = `目前編輯：${listName || activeName}`;
    els.editorTitle.textContent = title;
    els.editorHint.textContent = "";
    return;
  }

  const title = `建立清單：${listName || SHARE_DEFAULT_NAME}`;
  els.editorTitle.textContent = title;
  els.editorHint.textContent = "";
}

function getDefaultListName() {
  const names = new Set(
    state.lists
      .map(item => sanitizeListName(item?.name))
      .filter(Boolean)
  );

  if (!names.has(SHARE_DEFAULT_NAME)) {
    return SHARE_DEFAULT_NAME;
  }

  let index = 2;
  while (names.has(`${SHARE_DEFAULT_NAME} (${index})`)) {
    index += 1;
  }

  return `${SHARE_DEFAULT_NAME} (${index})`;
}

function updateIdiomCountHint(totalCount) {
  if (!els.idiomCount) return;
  const count = Number.parseInt(totalCount, 10);
  els.idiomCount.textContent = `（${Number.isFinite(count) ? count : 0} 筆）`;
}

function maybeUpdateShareOutput() {
  if (!state.draft.validIds.length) {
    els.shareUrl.value = "";
    els.shareMessage.value = "";
    setShareOutputDisabled(true);
    return;
  }

  const title = sanitizeListName(state.draft.name);
  const shareUrl = buildShareUrl(title, state.draft.validIds);
  const shareMessage = buildShareMessage(title, state.draft.validIds, shareUrl);
  els.shareUrl.value = shareUrl;
  els.shareMessage.value = shareMessage;
  els.openShare.href = shareUrl;
  setShareOutputDisabled(false);
}

function setShareOutputDisabled(disabled = true) {
  if (!disabled && !state.draft.validIds.length) {
    disabled = true;
  }

  els.copyShareUrl.disabled = disabled;
  els.copyShareMessage.disabled = disabled;
  els.openShare.setAttribute("aria-disabled", disabled ? "true" : "false");
}

function saveCurrentList() {
  const name = sanitizeListName(state.draft.name || els.listName.value);
  if (!state.draft.validIds.length) {
    setStatus("目前沒有可儲存的成語，請先輸入正確的成語。");
    return;
  }

  const upsertedId = upsertListById({
    id: state.activeListId,
    name,
    ids: state.draft.validIds
  });
  state.activeListId = upsertedId;

  renderSavedLists();
  applyListToForm(upsertedId, { preserveState: false });
  persistLists();
  setStatus(`已儲存清單「${name}」`);
}

function startNewDraft() {
  state.activeListId = "";
  clearDraftForm();
  setStatus("已清空為新清單模式，接著填入名稱與成語即可建立。");
}

function saveAsNewList() {
  const name = sanitizeListName(state.draft.name || els.listName.value);
  if (!state.draft.validIds.length) {
    setStatus("目前沒有可儲存的成語，請先輸入正確的成語。");
    return;
  }

  state.activeListId = "";
  const newListId = upsertListById({
    id: state.activeListId,
    name,
    ids: state.draft.validIds
  });

  if (newListId) {
    state.activeListId = newListId;
    applyListToForm(newListId);
  }

  renderSavedLists();
  setStatus(`已另存新清單「${name}」`);
}

function clearDraftForm() {
  els.listName.value = getDefaultListName();
  els.idiomLines.value = "";
  updateListNameInputState();
  updateDraftFromInputs();
}

function updateListNameInputState() {
  const isInvalid = !String(els.listName.value || "").trim();
  els.listName.classList.toggle("is-invalid", isInvalid);
}

function applyRandomIdiomsToInput() {
  const currentValue = String(els.idiomLines.value || "").replace(/\r/g, "");
  const currentRows = currentValue
    .split("\n")
    .map(row => String(row || "").trim())
    .filter(Boolean);
  const randomRows = getRandomIdiomLines(1, currentRows);

  if (!randomRows.length) {
    setStatus("目前無法再新增成語，請稍後再試。");
    return;
  }

  const suffix = currentValue.trimEnd();
  const idiom = randomRows[0];
  els.idiomLines.value = suffix ? `${suffix}\n${idiom}` : idiom;
  updateDraftFromInputs();
  setStatus("已自動新增 1 筆成語到最後面，您可繼續點擊補齊更多。");
}

function parseIdiomLines(rawText) {
  const rows = [];
  const seen = new Set();
  const validIds = [];
  let missingCount = 0;
  let duplicateCount = 0;

  String(rawText || "")
    .replace(/\r/g, "")
    .split("\n")
    .forEach((line, index) => {
      const text = String(line || "").trim();
      if (!text) return;

      const found = state.idiomByName.get(normalizeText(text));
      if (!found) {
        rows.push({
          line: index + 1,
          text,
          status: "missing"
        });
        missingCount += 1;
        return;
      }

      const id = normalizeId(found.編號);
      if (!id) {
        rows.push({
          line: index + 1,
          text,
          status: "missing"
        });
        missingCount += 1;
        return;
      }

      if (seen.has(id)) {
        rows.push({
          line: index + 1,
          text: found.成語 || text,
          status: "duplicate"
        });
        duplicateCount += 1;
        return;
      }

      seen.add(id);
      validIds.push(id);
      rows.push({
        line: index + 1,
        text: found.成語 || text,
        status: "valid"
      });
    });

  return { rows, validIds, missingCount, duplicateCount, count: validIds.length };
}

function getRandomIdiomLines(count = 1, existingRows = []) {
  if (!Array.isArray(state.idioms) || !state.idioms.length || count <= 0) {
    return [];
  }

  const existingSet = new Set((existingRows || [])
    .map(value => normalizeText(value))
    .filter(Boolean));

  const pool = [...state.idioms]
    .map(item => String(item?.成語 || "").trim())
    .filter(Boolean)
    .filter(value => !existingSet.has(normalizeText(value)));

  if (!pool.length) return [];

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const unique = [];
  const seen = new Set();
  for (const idiom of pool) {
    if (!seen.has(idiom)) {
      seen.add(idiom);
      unique.push(idiom);
    }

    if (unique.length >= count) {
      break;
    }
  }

  return unique;
}

function renderSavedLists() {
  const lists = [...state.lists];
  els.savedCount.textContent = `${lists.length} 組`;

  if (!lists.length) {
    els.listContainer.innerHTML = `<p class="empty-state">尚未建立清單。先輸入名稱與成語後按「儲存目前清單」。</p>`;
    return;
  }

  const sorted = lists
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  els.listContainer.innerHTML = sorted.map(item => `
    <div class="list-item ${item.id === state.activeListId ? "is-active" : ""}" data-list-id="${escapeHtml(item.id)}">
      <button class="list-item__open" type="button" data-action="open">
        <span class="list-item__meta">更新：${formatTimestamp(item.updatedAt || item.createdAt)}</span>
        <span class="list-item__title">${escapeHtml(item.name)}（${item.ids.length} 筆）</span>
      </button>
      <div class="list-item__toolbar">
        <button class="button button--secondary list-item-action list-item-action--copy" type="button" data-action="copy">複製連結</button>
        <button class="button button--secondary list-item-action list-item-action--delete" type="button" data-action="delete" aria-label="刪除清單「${escapeHtml(item.name)}」">刪除</button>
      </div>
    </div>
  `).join("");
}

function formatTimestamp(timestamp) {
  const value = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(value)) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-Hant", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function applyListToForm(listId, options = {}) {
  const list = getListById(listId);
  if (!list) {
    setStatus("找不到對應清單。");
    return;
  }

  state.activeListId = list.id;
  els.listName.value = list.name;
  els.idiomLines.value = list.ids
    .map(id => state.idiomById.get(id)?.成語 || id)
    .filter(Boolean)
    .join("\n");
  updateIdiomCountHint(list.ids.length);
  updateListNameInputState();

  if (!options.preserveState) {
    updateDraftFromInputs();
  }
  maybeUpdateShareOutput();
  renderSavedLists();
  updateDraftHint();
}

function deleteList(listId) {
  const list = getListById(listId);
  if (!list) return;

  const next = window.confirm(`確定要刪除「${list.name}」嗎？`);
  if (!next) return;

  const removed = state.lists.filter(item => item.id !== listId);
  state.lists = removed;

  if (state.activeListId === listId) {
    state.activeListId = state.lists[0]?.id || "";
  }

  persistLists();
  renderSavedLists();

  if (!state.activeListId) {
    clearDraftForm();
  } else {
    applyListToForm(state.activeListId);
  }

  setStatus(`已刪除清單「${list.name}」`);
}

function copyListShare(listId) {
  const list = getListById(listId);
  if (!list) return;

  const shareUrl = buildShareUrl(list.name, list.ids);
  copyTextToClipboard(`${shareUrl}`, "網址");
}

function upsertListById({ id, name, ids }) {
  const normalizedIds = [...new Set(ids.map(normalizeId).filter(Boolean))];
  const normalizedName = sanitizeListName(name);
  const timestamp = Date.now();

  if (id) {
    const index = state.lists.findIndex(item => item.id === id);
    if (index >= 0) {
      state.lists[index].name = normalizedName || SHARE_DEFAULT_NAME;
      state.lists[index].ids = normalizedIds;
      state.lists[index].updatedAt = timestamp;
      persistLists();
      return id;
    }
  }

  const nextId = `list-${timestamp}-${Math.random().toString(36).slice(2, 6)}`;
  const newList = {
    id: nextId,
    name: normalizedName || SHARE_DEFAULT_NAME,
    ids: normalizedIds,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.lists.unshift(newList);
  persistLists();
  return nextId;
}

function importSharedList(shared) {
  if (!shared || !shared.ids.length) return;

  const existing = state.lists.find(item =>
    item.name === shared.name &&
    isSameIdList(item.ids, shared.ids)
  );

  if (existing) {
    state.activeListId = existing.id;
    applyListToForm(existing.id);
    return;
  }

  const importId = `shared-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const imported = {
    id: importId,
    name: `${shared.name}（分享）`,
    ids: shared.ids,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  state.lists.unshift(imported);
  state.activeListId = importId;
  persistLists();
  renderSavedLists();
  applyListToForm(importId);
  updateDraftFromInputs();
  maybeUpdateShareOutput();
}

function getSharedPayloadFromUrl() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  const encodedIds = hashParams.get(SHARE_HASH_IDS_PARAM) || searchParams.get(SHARE_IDS_PARAM);
  if (!encodedIds) return null;

  const rawTitle = sanitizeListName(hashParams.get(SHARE_TITLE_PARAM) || searchParams.get(SHARE_TITLE_PARAM));
  const ids = decodeSharedIds(encodedIds);
  if (!ids.length) return null;

  window.history.replaceState({}, "", window.location.pathname);
  return { name: rawTitle || SHARE_DEFAULT_NAME, ids };
}

function decodeSharedIds(raw) {
  const ids = [];
  const seen = new Set();
  String(raw || "")
    .split(".")
    .filter(Boolean)
    .forEach(token => {
      const id = Number.parseInt(token, 36);
      if (!Number.isFinite(id)) return;
      const normalized = String(id);
      if (!state.idiomById.has(normalized)) return;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        ids.push(normalized);
      }
    });

  return ids;
}

function buildShareParams(title, ids) {
  const params = new URLSearchParams();
  const encodedIds = ids
    .map(id => {
      const value = Number.parseInt(id, 10);
      return Number.isFinite(value) ? value.toString(36) : "";
    })
    .filter(Boolean);

  params.set(SHARE_HASH_IDS_PARAM, encodedIds.join("."));
  const normalizedName = sanitizeListName(title);
  if (normalizedName) params.set(SHARE_TITLE_PARAM, normalizedName);
  return params.toString();
}

function buildShareUrl(name, ids) {
  const params = buildShareParams(name, ids);
  return `${window.location.origin}/#${params}`;
}

function buildShareMessage(name, ids, url) {
  return `我幫你整理了一份成語清單「${sanitizeListName(name)}」，共 ${ids.length} 筆，點這裡直接開啟：${url}`;
}

async function copyTextToClipboard(rawText, label) {
  const text = String(rawText || "").trim();
  if (!text) return;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(label);
      return;
    }
  } catch {
    // fallback to prompt
  }

  window.prompt(`請手動複製${label}`, text);
}

async function copyShareFieldContent(field, fallbackLabel = "文字") {
  const text = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? String(field.value || "").trim() : "";
  if (!text) return;

  if (typeof field.focus === "function") field.focus();
  if (typeof field.select === "function") field.select();
  if (typeof field.setSelectionRange === "function") {
    field.setSelectionRange(0, field.value.length);
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fallback to prompt below
  }

  window.prompt(`請手動複製${fallbackLabel}`, text);
}

function setCopyFeedback(label) {
  const button = label === "網址" ? els.copyShareUrl : els.copyShareMessage;
  const original = button.textContent;
  button.textContent = "已複製";
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1200);
}

function setStatus(message) {
  els.listStatus.textContent = message;
  window.clearTimeout(state.statusTimer);
  state.statusTimer = window.setTimeout(() => {
    els.listStatus.textContent = "";
  }, 2800);
}

function readListsFromStorage() {
  try {
    const raw = localStorage.getItem(LIST_STORAGE_KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw);
    const listItems = Array.isArray(payload) ? payload : payload?.lists;

    if (!Array.isArray(listItems)) return [];

    state.activeListId = (!Array.isArray(payload) ? payload.activeId : "") || "";
    return listItems
      .map(item => {
        if (!item || typeof item !== "object") return null;
        const ids = normalizeStoredIds(item.ids || []);
        return ids.length
          ? {
              id: sanitizeListId(item.id),
              name: sanitizeListName(item.name || ""),
              ids,
              createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
              updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
            }
          : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function persistLists() {
  try {
    localStorage.setItem(LIST_STORAGE_KEY, JSON.stringify({
      version: 1,
      activeId: state.activeListId,
      lists: state.lists
    }));
  } catch {}
}

function getListById(id) {
  return state.lists.find(item => item.id === id) || null;
}

function isSameIdList(left, right) {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

function normalizeStoredIds(rawIds) {
  if (!Array.isArray(rawIds)) return [];
  return [...new Set(rawIds
    .map(id => normalizeId(id))
    .filter(Boolean))];
}

function normalizeIdioms(raw) {
  return Array.isArray(raw)
    ? raw.map(item => item || {}).filter(item => item && item.成語)
    : [];
}

function buildIdiomLookupByName(items) {
  const map = new Map();
  items.forEach(item => {
    const key = normalizeText(item.成語);
    if (key && !map.has(key)) map.set(key, item);
  });
  return map;
}

function buildIdiomLookupById(items) {
  const map = new Map();
  items.forEach(item => {
    const id = normalizeId(item.編號);
    if (id) map.set(id, item);
  });
  return map;
}

function sanitizeListId(rawId) {
  const id = String(rawId || "").trim();
  return id || `list-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function sanitizeListName(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized) return SHARE_DEFAULT_NAME;
  return normalized.slice(0, LIST_NAME_MAX);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u3000\s]+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeId(value) {
  return String(value || "").trim();
}

function loadData() {
  return fetch(DATA_URL).then(response => {
    if (!response.ok) throw new Error(`資料載入失敗：${response.status}`);
    return response.json();
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&#34;")
    .replaceAll("'", "&#39;");
}

const DATA_URL = "dict_idioms_2020_20260324.min.json";
const MAX_RESULTS = 24;
const FAVORITES_KEY = "dict-idioms-favorites";
const DEFAULT_FAVORITES_TITLE = "我的收藏";
const FAVORITES_EXPORT_SCHEMA = "dict-idioms-favorites@1";
const FAVORITE_DRAG_THRESHOLD = 6;
const PRONUNCIATION_MODE_KEY = "dict-idioms-pronunciation-mode";
const DEFAULT_OPEN_COUNT = 6;
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
  filter: "all",
  openId: "",
  pronunciationMode: readPronunciationMode(),
  dailyItem: null,
  favoritesTitle: favoriteSettings.title,
  favorites: new Set(favoriteSettings.favorites)
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
  favoritesTitle: document.querySelector("#favorites-title"),
  favoritesCount: document.querySelector("#favoritesCount"),
  favoritesList: document.querySelector("#favoritesList"),
  favoritesStatus: document.querySelector("#favoritesStatus"),
  importFavorites: document.querySelector("#importFavorites"),
  exportFavorites: document.querySelector("#exportFavorites"),
  importFavoritesFile: document.querySelector("#importFavoritesFile"),
  clearFavorites: document.querySelector("#clearFavorites"),
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

    els.dataStatus.textContent = `已載入 ${state.idioms.length.toLocaleString("zh-TW")} 筆成語`;
    setDailyCard();
    setQuickPicks();
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

  els.importFavorites.addEventListener("click", () => {
    els.importFavoritesFile.click();
  });

  els.importFavoritesFile.addEventListener("change", async () => {
    const [file] = els.importFavoritesFile.files || [];
    if (!file) return;

    try {
      await importFavoritesFromFile(file);
    } finally {
      els.importFavoritesFile.value = "";
    }
  });

  els.exportFavorites.addEventListener("click", exportFavorites);

  els.clearFavorites.addEventListener("click", () => {
    state.favorites.clear();
    saveFavorites();
    renderFavorites();
    renderResults(searchIdioms());
    setFavoritesStatus("已清空收藏");
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

  document.addEventListener("pointermove", handleFavoritePointerMove);
  document.addEventListener("pointerup", handleFavoritePointerUp);
  document.addEventListener("pointercancel", cancelFavoritePointerDrag);
  document.addEventListener("mousemove", handleFavoritePointerMove);
  document.addEventListener("mouseup", handleFavoritePointerUp);

  window.addEventListener("popstate", syncFromLocation);
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
  const list = items.filter(item => item._main).length
    ? items.filter(item => item._main)
    : items;
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
    block("典故說明", item.典故說明),
    listBlock("用法例句", item["用法說明-例句"], 4, item.成語),
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
  const quiz = parseIdentificationQuiz(item["辨識-例句"]);
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
  const match = String(item || "").match(/^(\d\d\.)\s*(.*)$/);
  if (!match) return `<li>${renderLinkedText(item)}</li>`;

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
        state.favorites.delete(String(item.編號 || item.成語));
        saveFavorites();
        renderFavorites();
        renderResults(searchIdioms());
        setFavoritesStatus(`已刪除「${item.成語}」`);
        return;
      }

      els.input.value = item.成語;
      state.query = normalize(item.成語);
      renderResults([item]);
      updateLocationFromState(item.編號 || item.成語, true);
    });
  });
}

function syncFavoritesCount(count = state.favorites.size) {
  els.favoritesCount.textContent = `${count.toLocaleString("zh-TW")} 筆`;
}

function handleFavoritePointerDown(event) {
  if (favoritePointerDrag) return;
  if (event.button !== 0 || event.target.closest(".favorite-remove-button")) return;

  const item = event.currentTarget;
  const favoriteId = item.dataset.favoriteId || "";
  if (!favoriteId) return;

	  favoritePointerDrag = {
	    id: favoriteId,
	    pointerId: getFavoritePointerId(event),
	    source: item,
	    sourceIndex: [...state.favorites].indexOf(favoriteId),
	    startX: event.clientX,
	    startY: event.clientY,
    targetId: "",
    placeAfterTarget: false,
    isDragging: false,
    preview: null,
    offsetX: 0,
    offsetY: 0
  };
}

function handleFavoritePointerMove(event) {
  if (!favoritePointerDrag || favoritePointerDrag.pointerId !== getFavoritePointerId(event)) return;

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

  state.favorites = new Set(favoriteKeys);
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

function startFavoriteTitleEdit() {
  if (isEditingFavoriteTitle()) return;

  favoriteTitleBeforeEdit = state.favoritesTitle;
  els.favoritesTitle.setAttribute("contenteditable", "true");
  els.favoritesTitle.classList.add("is-editing");
  els.favoritesTitle.focus();
  selectElementText(els.favoritesTitle);
}

function commitFavoriteTitleEdit() {
  const nextTitle = normalizeFavoriteTitle(els.favoritesTitle.textContent);
  const changed = nextTitle !== state.favoritesTitle;

  state.favoritesTitle = nextTitle;
  endFavoriteTitleEdit();
  syncFavoritesTitle();
  saveFavorites();

  if (changed) setFavoritesStatus("已更新收藏標題");
}

function cancelFavoriteTitleEdit() {
  state.favoritesTitle = favoriteTitleBeforeEdit;
  endFavoriteTitleEdit();
  syncFavoritesTitle();
}

function endFavoriteTitleEdit() {
  els.favoritesTitle.removeAttribute("contenteditable");
  els.favoritesTitle.classList.remove("is-editing");
  window.getSelection()?.removeAllRanges();
}

function selectElementText(element) {
  const range = document.createRange();
  range.selectNodeContents(element);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
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

    if (imported.title !== null) state.favoritesTitle = imported.title;
    state.favorites = new Set(imported.favorites);
    saveFavorites();
    syncFavoritesTitle();
    renderFavorites();
    renderResults(searchIdioms());

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

function buildIdiomShareUrl(phrase) {
  const idiom = String(phrase || "").trim();
  return `https://stroke.gh.miniasp.com/?sentence=${encodeURIComponent(idiom)}`;
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
  state.openId = id;
  els.modalKind.textContent = item["主條成語／非主條成語"] || "成語條目";
  els.modalId.innerHTML = sourceId
    ? `編號 <a href="https://dict.idioms.moe.edu.tw/idiomView.jsp?ID=${encodeURIComponent(sourceId)}" target="_blank" rel="noopener">${escapeHtml(sourceId)}</a>`
    : "編號 未載明";
  els.modalTitle.textContent = item.成語 || "未命名成語";
  setupPronunciationToggle(els.modalPronunciation, item);

  const details = [
    usageContextBlock(item["用法說明-使用類別"]),
    meaningBlock(item["用法說明-語義說明"]),
    block("典故說明", item.典故說明),
    listBlock("用法例句", item["用法說明-例句"], 8, item.成語),
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
  const shareUrl = buildIdiomShareUrl(item.成語);

  if (favoriteInModal) {
    favoriteInModal.addEventListener("click", () => {
      toggleFavorite(item);
      favoriteInModal.textContent = state.favorites.has(id) ? "已收藏" : "收藏";
    });
  }

  if (writeWordInModal) {
    writeWordInModal.title = `前往「${item.成語 || "未命名成語"}」寫字頁面`;
    writeWordInModal.addEventListener("click", () => {
      window.open(shareUrl, "_blank", "noopener,noreferrer");
    });
  }

  if (shareInModal) {
    shareInModal.setAttribute("aria-live", "polite");
    shareInModal.addEventListener("click", async () => {
      const originalText = "分享";
      shareInModal.disabled = true;

      try {
        await navigator.clipboard?.writeText(shareUrl);
        shareInModal.textContent = "已複製連結";
      } catch {
        shareInModal.textContent = "複製失敗";
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

function cleanSourceTitle(value) {
  return String(value || "")
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
  const zhuyin = cleanText(item.注音);
  const pinyin = cleanText(item.漢語拼音);
  const hasBoth = Boolean(zhuyin && pinyin);
  button._pronunciation = { zhuyin, pinyin, hasBoth, primaryOnly: Boolean(options.primaryOnly) };

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

function renderPronunciationSyllables(value, options = {}) {
  const groups = splitPronunciationGroups(value);
  const visibleGroups = options.primaryOnly ? groups.slice(0, 1) : groups;
  const hasVariants = !options.primaryOnly && (groups.length > 1 || groups.some(group => group.label));

  return visibleGroups.map((group, index) => {
    const syllables = group.syllables
      .map(syllable => `<span class="pronunciation__syllable">${escapeHtml(syllable)}</span>`)
      .join("");
    const labelText = options.primaryOnly ? "" : pronunciationGroupLabel(group.label, index, hasVariants);
    const label = labelText ? `<span class="pronunciation__variant-label">${escapeHtml(labelText)}</span>` : "";

    return `<span class="pronunciation__group">${label}${syllables}</span>`;
  }).join("");
}

function pronunciationGroupLabel(label, index, hasVariants) {
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
  button.innerHTML = renderPronunciationSyllables(text, { primaryOnly: data.primaryOnly });
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
  const fallback = {
    title: DEFAULT_FAVORITES_TITLE,
    favorites: []
  };

  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return fallback;

    const payload = JSON.parse(raw);
    if (Array.isArray(payload)) {
      return {
        title: DEFAULT_FAVORITES_TITLE,
        favorites: normalizeStoredFavoriteKeys(payload)
      };
    }

    if (payload && typeof payload === "object") {
      return {
        title: normalizeFavoriteTitle(payload.title),
        favorites: normalizeStoredFavoriteKeys(payload.favorites || payload.items || [])
      };
    }

    return fallback;
  } catch {
    return fallback;
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify({
      title: state.favoritesTitle,
      favorites: [...state.favorites]
    }));
  } catch {}
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

const BOPOMOFO_INITIALS = {
  "ㄅ": "b", "ㄆ": "p", "ㄇ": "m", "ㄈ": "f", "ㄉ": "d", "ㄊ": "t", "ㄋ": "n", "ㄌ": "l",
  "ㄍ": "g", "ㄎ": "k", "ㄏ": "h", "ㄐ": "j", "ㄑ": "q", "ㄒ": "x",
  "ㄓ": "zh", "ㄔ": "ch", "ㄕ": "sh", "ㄖ": "r", "ㄗ": "z", "ㄘ": "c", "ㄙ": "s"
};
const BOPOMOFO_FINALS = {
  "ㄚ": "a", "ㄛ": "o", "ㄜ": "e", "ㄝ": "ê", "ㄞ": "ai", "ㄟ": "ei", "ㄠ": "ao", "ㄡ": "ou",
  "ㄢ": "an", "ㄣ": "en", "ㄤ": "ang", "ㄥ": "eng", "ㄦ": "er",
  "ㄧ": "i", "ㄧㄚ": "ia", "ㄧㄛ": "io", "ㄧㄝ": "ie", "ㄧㄞ": "iai", "ㄧㄠ": "iao", "ㄧㄡ": "iu",
  "ㄧㄢ": "ian", "ㄧㄣ": "in", "ㄧㄤ": "iang", "ㄧㄥ": "ing",
  "ㄨ": "u", "ㄨㄚ": "ua", "ㄨㄛ": "uo", "ㄨㄞ": "uai", "ㄨㄟ": "ui", "ㄨㄢ": "uan", "ㄨㄣ": "un",
  "ㄨㄤ": "uang", "ㄨㄥ": "ong",
  "ㄩ": "ü", "ㄩㄝ": "üe", "ㄩㄢ": "üan", "ㄩㄣ": "ün", "ㄩㄥ": "iong"
};
// 沒有聲母時，介音 ㄧ、ㄨ、ㄩ 開頭的韻母要改寫成 y、w、yu 開頭。
const BOPOMOFO_ZERO_INITIAL_FINALS = {
  i: "yi", ia: "ya", io: "yo", ie: "ye", iai: "yai", iao: "yao", iu: "you", ian: "yan",
  in: "yin", iang: "yang", ing: "ying", u: "wu", ua: "wa", uo: "wo", uai: "wai",
  ui: "wei", uan: "wan", un: "wen", uang: "wang", ong: "weng",
  "ü": "yu", "üe": "yue", "üan": "yuan", "ün": "yun", iong: "yong"
};
const PINYIN_TONED_VOWELS = { a: "āáǎà", o: "ōóǒò", e: "ēéěè", i: "īíǐì", u: "ūúǔù", "ü": "ǖǘǚǜ" };
const BOPOMOFO_TONE_INDEX = { "ˊ": 1, "ˇ": 2, "ˋ": 3 };
const BOPOMOFO_SYLLABLE_PATTERN = /^(˙)?([ㄅ-ㄙ])?([ㄧㄨㄩ])?([ㄚ-ㄦ])?([ˊˇˋ])?$/u;

// 將單一注音音節轉成漢語拼音；無法轉換時回傳空字串。
function bopomofoSyllableToPinyin(syllable) {
  // 沒有聲調符號的單獨 ㄦ 是兒化尾音（腿兒的 ㄦ），拼音為不標調的 er。
  if (syllable === "ㄦ") return "er";

  const match = BOPOMOFO_SYLLABLE_PATTERN.exec(syllable);
  if (!match) return "";
  const [, neutral, initialKey, medial = "", finalKey = "", toneKey] = match;
  const initial = BOPOMOFO_INITIALS[initialKey] || "";
  let final = BOPOMOFO_FINALS[medial + finalKey];

  // 只有聲母（ㄓㄔㄕㄖㄗㄘㄙ）時為舌尖元音，拼音寫作 zhi、chi、shi、ri、zi、ci、si。
  if (final === undefined && initial && !medial && !finalKey) final = "i";
  if (final === undefined) return "";

  if (!initial) final = BOPOMOFO_ZERO_INITIAL_FINALS[final] || final;
  else if ("jqx".includes(initial) && final.startsWith("ü")) final = final.replace("ü", "u");

  const pinyin = initial + final;
  return neutral ? pinyin : applyPinyinTone(pinyin, BOPOMOFO_TONE_INDEX[toneKey] || 0);
}

function applyPinyinTone(pinyin, toneIndex) {
  const index = findToneVowelIndex(pinyin);
  if (index < 0 || !PINYIN_TONED_VOWELS[pinyin[index]]) return pinyin;
  return pinyin.slice(0, index) + PINYIN_TONED_VOWELS[pinyin[index]][toneIndex] + pinyin.slice(index + 1);
}

function findToneVowelIndex(pinyin) {
  for (const vowel of ["a", "o", "e"]) {
    if (pinyin.includes(vowel)) return pinyin.indexOf(vowel);
  }
  if (pinyin.includes("iu")) return pinyin.indexOf("iu") + 1;
  if (pinyin.includes("ui")) return pinyin.indexOf("ui") + 1;
  for (let index = pinyin.length - 1; index >= 0; index -= 1) {
    if ("iuü".includes(pinyin[index])) return index;
  }
  return -1;
}
if (typeof module !== "undefined") module.exports = { bopomofoSyllableToPinyin };

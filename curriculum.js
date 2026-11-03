/* Arabic Foundations — Phase 1 curriculum data.
 *
 * Follows the classical qaida sequence (the same structure used by Muallimi Soniy,
 * Noorani Qaida, Yassarnal Qur'an, etc.): the 28 letters, how they connect, short
 * vowels, tanween, long vowels, sukun/shadda, then a first taste of tajweed and
 * real words. Letter+vowel drills (e.g. every letter with fatha/kasra/damma) are
 * generated at runtime in app.js from ARABIC_LETTERS + HARAKAT/MADD/TANWEEN below,
 * rather than hand-written — the combinations are mechanically regular.
 *
 * nonConnector letters (ا د ذ ر ز و) never join to the letter AFTER them, so they
 * only have two visual shapes (isolated/final look the same; there is no distinct
 * initial/medial shape) — app.js's formOf() uses this flag to decide how many
 * shapes to show.
 */
"use strict";

const ARABIC_LETTERS = [
  { id: "alif", letter: "ا", name: "Alif", translit: "ā / a", nonConnector: true,
    sound: "A glottal stop on its own (like the catch in ‘uh-oh’); after a fatha it becomes the long vowel ‘ā’.",
    example: { word: "اِسْم", translit: "ism", meaning: "name" } },
  { id: "ba", letter: "ب", name: "Bā’", translit: "b", moon: true,
    sound: "A crisp ‘b’, lips pressed together, as in ‘boy’.",
    example: { word: "بَيْت", translit: "bayt", meaning: "house" } },
  { id: "ta", letter: "ت", name: "Tā’", translit: "t", sun: true,
    sound: "A light ‘t’, tongue tip at the back of the upper teeth — lighter than English ‘t’.",
    example: { word: "تَمْر", translit: "tamr", meaning: "dates" } },
  { id: "tha", letter: "ث", name: "Thā’", translit: "th", sun: true,
    sound: "Like ‘th’ in English ‘think’, tongue between the teeth.",
    example: { word: "ثَوْب", translit: "thawb", meaning: "garment" } },
  { id: "jim", letter: "ج", name: "Jīm", translit: "j", moon: true,
    sound: "Like ‘j’ in ‘jam’.",
    example: { word: "جَمَل", translit: "jamal", meaning: "camel" } },
  { id: "ha_heavy", letter: "ح", name: "Ḥā’", translit: "ḥ", throat: true, moon: true,
    sound: "A strong, breathy ‘h’ from deep in the throat — no English equivalent; like exhaling hard while whispering ‘h’.",
    example: { word: "حَلِيب", translit: "ḥalīb", meaning: "milk" } },
  { id: "kha", letter: "خ", name: "Khā’", translit: "kh", heavy: true, throat: true, moon: true,
    sound: "Like ‘ch’ in German ‘Bach’ or Scottish ‘loch’ — a rough scrape at the back of the throat.",
    example: { word: "خُبْز", translit: "khubz", meaning: "bread" } },
  { id: "dal", letter: "د", name: "Dāl", translit: "d", sun: true, nonConnector: true,
    sound: "A crisp ‘d’, tongue tip at the upper teeth — lighter than English ‘d’.",
    example: { word: "دَار", translit: "dār", meaning: "house" } },
  { id: "dhal", letter: "ذ", name: "Dhāl", translit: "dh", sun: true, nonConnector: true,
    sound: "Like ‘th’ in English ‘this’ (voiced), tongue between the teeth.",
    example: { word: "ذَهَب", translit: "dhahab", meaning: "gold" } },
  { id: "ra", letter: "ر", name: "Rā’", translit: "r", sun: true, nonConnector: true,
    sound: "A rolled/flapped ‘r’, tongue tip tapping the roof of the mouth (like Uzbek/Spanish r).",
    example: { word: "رَجُل", translit: "rajul", meaning: "man" } },
  { id: "zay", letter: "ز", name: "Zāy", translit: "z", sun: true, nonConnector: true,
    sound: "A ‘z’ as in ‘zoo’.",
    example: { word: "زَيْت", translit: "zayt", meaning: "oil" } },
  { id: "sin", letter: "س", name: "Sīn", translit: "s", sun: true,
    sound: "A clear ‘s’ as in ‘see’.",
    example: { word: "سَمَك", translit: "samak", meaning: "fish" } },
  { id: "shin", letter: "ش", name: "Shīn", translit: "sh", sun: true,
    sound: "‘sh’ as in ‘she’.",
    example: { word: "شَمْس", translit: "shams", meaning: "sun" } },
  { id: "sad", letter: "ص", name: "Ṣād", translit: "ṣ", heavy: true, sun: true,
    sound: "A heavy, emphatic ‘s’ — pull the back of the tongue up and back while making ‘s’.",
    example: { word: "صَبْر", translit: "ṣabr", meaning: "patience" } },
  { id: "dad", letter: "ض", name: "Ḍād", translit: "ḍ", heavy: true, sun: true,
    sound: "A heavy, emphatic ‘d’ — the same backward tongue pull as Ṣād but for ‘d’. Often the hardest letter for learners.",
    example: { word: "ضَيْف", translit: "ḍayf", meaning: "guest" } },
  { id: "ta_heavy", letter: "ط", name: "Ṭā’", translit: "ṭ", heavy: true, qalqalah: true, sun: true,
    sound: "A heavy, emphatic ‘t’.",
    example: { word: "طَبِيب", translit: "ṭabīb", meaning: "doctor" } },
  { id: "za_heavy", letter: "ظ", name: "Ẕā’", translit: "ẕ", heavy: true, sun: true,
    sound: "A heavy, emphatic version of ‘th’ (as in ‘this’), tongue pulled back and tensed.",
    example: { word: "ظُهْر", translit: "ẕuhr", meaning: "noon" } },
  { id: "ayn", letter: "ع", name: "ʿAyn", translit: "ʿ", throat: true, moon: true,
    sound: "A voiced, pharyngeal sound made by tightening the throat — no English equivalent; like the start of a gentle gag, voiced.",
    example: { word: "عَيْن", translit: "ʿayn", meaning: "eye" } },
  { id: "ghayn", letter: "غ", name: "Ghayn", translit: "gh", heavy: true, throat: true, moon: true,
    sound: "A soft, voiced, gargling sound at the back of the throat, like a French ‘r’.",
    example: { word: "غَيْم", translit: "ghaym", meaning: "cloud" } },
  { id: "fa", letter: "ف", name: "Fā’", translit: "f", moon: true,
    sound: "An ‘f’ as in ‘far’, lower lip against upper teeth.",
    example: { word: "فِيل", translit: "fīl", meaning: "elephant" } },
  { id: "qaf", letter: "ق", name: "Qāf", translit: "q", heavy: true, qalqalah: true, moon: true,
    sound: "A deep ‘k’ made at the very back of the throat/uvula — lower and further back than Kāf.",
    example: { word: "قَلَم", translit: "qalam", meaning: "pen" } },
  { id: "kaf", letter: "ك", name: "Kāf", translit: "k", moon: true,
    sound: "A regular ‘k’ as in ‘key’.",
    example: { word: "كِتَاب", translit: "kitāb", meaning: "book" } },
  { id: "lam", letter: "ل", name: "Lām", translit: "l", sun: true,
    sound: "An ‘l’ as in ‘love’.",
    example: { word: "لَيْل", translit: "layl", meaning: "night" } },
  { id: "mim", letter: "م", name: "Mīm", translit: "m", moon: true,
    sound: "An ‘m’ as in ‘moon’.",
    example: { word: "مَاء", translit: "māʾ", meaning: "water" } },
  { id: "nun", letter: "ن", name: "Nūn", translit: "n", sun: true,
    sound: "An ‘n’ as in ‘noon’.",
    example: { word: "نُور", translit: "nūr", meaning: "light" } },
  { id: "ha_light", letter: "ه", name: "Hā’", translit: "h", throat: true, moon: true,
    sound: "A light ‘h’ as in English ‘hello’.",
    example: { word: "هِلَال", translit: "hilāl", meaning: "crescent moon" } },
  { id: "waw", letter: "و", name: "Wāw", translit: "w / ū", moon: true, nonConnector: true,
    sound: "A ‘w’ as in ‘wow’; after a damma it becomes the long vowel ‘ū’.",
    example: { word: "وَرْد", translit: "ward", meaning: "rose" } },
  { id: "ya", letter: "ي", name: "Yā’", translit: "y / ī", moon: true,
    sound: "A ‘y’ as in ‘yes’; after a kasra it becomes the long vowel ‘ī’.",
    example: { word: "يَد", translit: "yad", meaning: "hand" } },
];

// Short vowels (harakat) — combining marks placed over/under a letter.
const HARAKAT = [
  { id: "fatha", mark: "َ", name: "Fatha", translit: "a", sound: "A short ‘a’, like ‘a’ in ‘cat’." },
  { id: "kasra", mark: "ِ", name: "Kasra", translit: "i", sound: "A short ‘i’, like ‘i’ in ‘sit’." },
  { id: "damma", mark: "ُ", name: "Damma", translit: "u", sound: "A short ‘u’, like ‘u’ in ‘put’." },
];

// Nunation — doubled vowel mark at the end of a word, adds a trailing ‘n’.
const TANWEEN = [
  { id: "fathatan", mark: "ً", name: "Fathatan", translit: "an" },
  { id: "kasratan", mark: "ٍ", name: "Kasratan", translit: "in" },
  { id: "dammatan", mark: "ٌ", name: "Dammatan", translit: "un" },
];

// Long vowels (madd) — a harakat on the letter followed by its matching madd letter.
const MADD = [
  { id: "madd_a", after: "fatha", letter: "ا", name: "Alif madd", translit: "ā" },
  { id: "madd_u", after: "damma", letter: "و", name: "Waw madd", translit: "ū" },
  { id: "madd_i", after: "kasra", letter: "ي", name: "Ya madd", translit: "ī" },
];

const SUKUN = "ْ";   // no vowel — the letter is "closed"
const SHADDA = "ّ";  // doubles/geminates the consonant

// Phase 1 lesson sequence. "letters" entries list ARABIC_LETTERS ids to cover;
// other kinds are rendered generically by app.js from the data above.
const ARABIC_CURRICULUM = [
  { id: 1, kind: "letters", title: "Alif to Jīm", ids: ["alif", "ba", "ta", "tha", "jim"] },
  { id: 2, kind: "letters", title: "Ḥā’ to Dhāl", ids: ["ha_heavy", "kha", "dal", "dhal"] },
  { id: 3, kind: "letters", title: "Rā’ to Shīn", ids: ["ra", "zay", "sin", "shin"] },
  { id: 4, kind: "letters", title: "Ṣād to Ẕā’", ids: ["sad", "dad", "ta_heavy", "za_heavy"] },
  { id: 5, kind: "letters", title: "ʿAyn to Qāf", ids: ["ayn", "ghayn", "fa", "qaf"] },
  { id: 6, kind: "letters", title: "Kāf to Yā’", ids: ["kaf", "lam", "mim", "nun", "ha_light", "waw", "ya"] },
  { id: 7, kind: "forms", title: "Letter Forms — How Letters Join" },
  { id: 8, kind: "harakat", title: "Short Vowels — Fatha, Kasra, Damma" },
  { id: 9, kind: "tanween", title: "Tanween — the Trailing N" },
  { id: 10, kind: "madd", title: "Long Vowels — Madd" },
  { id: 11, kind: "sukun_shadda", title: "Sukūn & Shadda" },
  { id: 12, kind: "tajweed", title: "Tajweed Basics — Heavy Letters, Throat Letters, Qalqalah" },
  { id: 13, kind: "words", title: "Reading Practice — Words, Phrases & Your First Surahs" },
];

if (typeof window !== "undefined") {
  window.ARABIC_LETTERS = ARABIC_LETTERS;
  window.HARAKAT = HARAKAT;
  window.TANWEEN = TANWEEN;
  window.MADD = MADD;
  window.SUKUN = SUKUN;
  window.SHADDA = SHADDA;
  window.ARABIC_CURRICULUM = ARABIC_CURRICULUM;
}

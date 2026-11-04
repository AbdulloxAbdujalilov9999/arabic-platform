/* Arabic Foundations — personal course engine. Single owner account, no
 * student/teacher/admin machinery: just sign in, learn, and talk to the AI
 * teacher. shared/firebase.js points at the same Firebase project as
 * truck-talk-webapp (truck-talk-admin) on purpose, for one continuous
 * account/progress history — this is otherwise a fully separate app/repo/
 * deployment from truck-talk-webapp.
 */
import { auth, db, googleProvider, isFirebaseConfigured, usesRedirectSignIn } from "./shared/firebase.js";
import { ALLOWED_EMAILS } from "./shared/firebase-config.js";
import {
  onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { ref, get, set, onValue } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const LETTERS = window.ARABIC_LETTERS;
const HARAKAT = window.HARAKAT;
const TANWEEN = window.TANWEEN;
const MADD = window.MADD;
const SUKUN = window.SUKUN;
const SHADDA = window.SHADDA;
const CURRICULUM = window.ARABIC_CURRICULUM;
const TATWEEL = "ـ";

const byId = (id) => LETTERS.find((l) => l.id === id);
const $ = (sel, root) => (root || document).querySelector(sel);
const el = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const k in attrs || {}) {
    if (k === "html") n.innerHTML = attrs[k];
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};

/* ---------------- Theme ---------------- */
(function initTheme() {
  try {
    const t = localStorage.getItem("ar_theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("ar_theme", next); } catch (e) {}
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(msg) {
  let t = $("#toast");
  if (!t) { t = el("div", { id: "toast", class: "toast" }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------------- Auth gate ---------------- */
let currentUser = null;

function renderNotConfigured() {
  $("#authRoot").replaceChildren(el("div", { class: "signin-card" },
    el("h1", {}, "Setup needed"),
    el("p", {}, "Firebase isn’t configured yet. This shares the same project as the rest of the site."),
  ));
}
function renderSignIn(errorMsg) {
  $("#appShell").hidden = true;
  const card = el("div", { class: "signin-card" },
    el("div", { class: "glyph" }, "العربية"),
    el("h1", {}, "Arabic Foundations"),
    el("p", {}, "A personal, zero-to-Qur’an Arabic course with an AI teacher. Private — sign in with the same account you use for Truck Talk."),
    el("button", { class: "btn btn-primary", onclick: doSignIn }, "Sign in with Google"),
    el("div", { class: "signin-error" }, errorMsg || ""),
  );
  $("#authRoot").replaceChildren(card);
  $("#authRoot").hidden = false;
}
function renderDenied(email) {
  $("#appShell").hidden = true;
  const card = el("div", { class: "signin-card" },
    el("div", { class: "glyph" }, "معذرة"),
    el("h1", {}, "This app is private"),
    el("p", { class: "signin-denied" }, "Signed in as " + (email || "this account") + ". This course is private — ask the owner if you think you should have access."),
    el("button", { class: "btn btn-ghost", onclick: () => signOut(auth) }, "Sign out"),
  );
  $("#authRoot").replaceChildren(card);
  $("#authRoot").hidden = false;
}
async function doSignIn() {
  try {
    if (usesRedirectSignIn) await signInWithRedirect(auth, googleProvider);
    else await signInWithPopup(auth, googleProvider);
  } catch (err) {
    renderSignIn((err && err.message) || "Sign-in failed. Please try again.");
  }
}

function boot() {
  if (!isFirebaseConfigured) { renderNotConfigured(); return; }
  if (usesRedirectSignIn) getRedirectResult(auth).catch((err) => renderSignIn(err && err.message));
  onAuthStateChanged(auth, (user) => {
    if (!user) { currentUser = null; renderSignIn(""); return; }
    if (!ALLOWED_EMAILS.includes(user.email)) { currentUser = null; renderDenied(user.email); return; }
    currentUser = user;
    $("#authRoot").hidden = true;
    mountApp();
  });
}

/* ---------------- Progress ---------------- */
const PKEY = "ar_progress_v1";
let progress = { completed: {}, lastLesson: 1 };
function loadLocalProgress() {
  try { const p = JSON.parse(localStorage.getItem(PKEY) || "null"); if (p) progress = p; } catch (e) {}
}
function saveLocalProgress() {
  try { localStorage.setItem(PKEY, JSON.stringify(progress)); } catch (e) {}
}
function markDone(lessonId) {
  progress.completed[lessonId] = true;
  progress.lastLesson = lessonId;
  saveLocalProgress();
  if (db && currentUser) set(ref(db, "arabic/progress/" + currentUser.uid), progress).catch(() => {});
  renderSidebar();
}
function syncProgressFromCloud() {
  if (!db || !currentUser) return;
  onValue(ref(db, "arabic/progress/" + currentUser.uid), (snap) => {
    const cloud = snap.val();
    if (!cloud) { set(ref(db, "arabic/progress/" + currentUser.uid), progress).catch(() => {}); return; }
    const merged = { completed: { ...cloud.completed, ...progress.completed }, lastLesson: Math.max(cloud.lastLesson || 1, progress.lastLesson || 1) };
    progress = merged;
    saveLocalProgress();
    renderSidebar();
  }, { onlyOnce: false });
}

/* ---------------- TTS ---------------- */
async function authHeader() {
  const token = currentUser && (await currentUser.getIdToken());
  return token ? { authorization: "Bearer " + token } : {};
}
let currentAudio = null;
async function speak(text, btn) {
  if (btn) { btn.disabled = true; btn.dataset.prevHtml = btn.innerHTML; btn.textContent = "⋯"; }
  try {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    const headers = await authHeader();
    const r = await fetch("/api/tts?t=" + encodeURIComponent(text), { headers });
    if (!r.ok) throw new Error("tts-" + r.status);
    const blob = await r.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    currentAudio = audio;
    await audio.play();
  } catch (e) {
    speakBrowserFallback(text);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.prevHtml; }
  }
}
function speakBrowserFallback(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ar-SA";
    const voices = speechSynthesis.getVoices();
    const arVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ar"));
    if (arVoice) u.voice = arVoice;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function playBtn(text, size) {
  return el("button", { class: "play-btn" + (size === "small" ? " small" : ""), title: "Listen", onclick: (e) => speak(text, e.currentTarget) }, "▶");
}

/* ---------------- Letter forms (tatweel trick) ---------------- */
function formsOf(entry) {
  const L = entry.letter;
  if (entry.nonConnector) return [["Isolated", L], ["Final", TATWEEL + L]];
  return [["Isolated", L], ["Initial", L + TATWEEL], ["Medial", TATWEEL + L + TATWEEL], ["Final", TATWEEL + L]];
}

/* ---------------- Flashcard ---------------- */
function tagEl(label, cls) { return el("span", { class: "tag tag-" + cls }, label); }
function letterCard(entry) {
  const tags = [];
  if (entry.heavy) tags.push(tagEl("Heavy", "heavy"));
  if (entry.throat) tags.push(tagEl("Throat", "throat"));
  if (entry.qalqalah) tags.push(tagEl("Qalqalah", "qalqalah"));
  if (entry.sun) tags.push(tagEl("Sun letter", "sun"));
  if (entry.moon) tags.push(tagEl("Moon letter", "moon"));
  const forms = el("div", { class: "forms-row" },
    formsOf(entry).map(([label, glyph]) => el("div", { class: "form" }, el("span", { class: "glyph" }, glyph), label)));
  return el("div", { class: "flashcard" },
    el("div", { class: "big-letter" }, entry.letter),
    el("div", { class: "letter-name" }, entry.name),
    el("div", { class: "letter-translit" }, entry.translit),
    forms,
    el("div", {}, tags),
    el("div", { class: "sound-desc" }, entry.sound),
    el("div", { class: "example-word" },
      el("div", {}, el("div", { class: "w" }, entry.example.word), el("div", { class: "meaning" }, entry.example.translit + " — " + entry.example.meaning)),
      playBtn(entry.example.word)),
    el("div", { style: "text-align:center;margin-top:10px" }, playBtn(entry.letter, "small")),
  );
}
/* ---------------- Drill tables ---------------- */
function drillTable(cols, rows) {
  const thead = el("tr", {}, cols.map((c) => el("th", {}, c)));
  const trs = rows.map((row) => el("tr", {}, row.map((cell) =>
    el("td", { onclick: (e) => speak(cell.speak, e.currentTarget) }, el("span", { class: "glyph" }, cell.glyph)))));
  return el("table", { class: "drill-table" }, el("thead", {}, thead), el("tbody", {}, trs));
}

/* ---------------- Lesson renderers ---------------- */
function renderLetters(ids) {
  return el("div", { class: "card-grid" }, ids.map((id) => letterCard(byId(id))));
}
function renderForms() {
  const examples = ["ba", "sin", "alif", "waw"].map(byId);
  const wrap = el("div", {});
  wrap.append(el("p", { class: "sound-desc" },
    "Arabic is written cursive: most letters change shape slightly depending on whether they open a word (initial), sit in the middle (medial), end a word (final), or stand alone (isolated). Six letters — ا د ذ ر ز و — never connect to the letter that comes AFTER them, so they only really have two shapes."));
  wrap.append(el("div", { class: "card-grid" }, examples.map(letterCard)));
  wrap.append(el("h4", {}, "Worked example: كِتَاب (kitāb, “book”)"));
  wrap.append(el("div", { class: "example-word" },
    el("div", { class: "w" }, "كِتَاب"), playBtn("كِتَاب")));
  wrap.append(el("p", { class: "sound-desc" },
    "ك Kāf takes its INITIAL shape (it opens the word and connects forward) → ت Tā’ takes its MEDIAL shape (connected on both sides) → ا Alif is a non-connector, so it just sits there as itself → ب Bā’ takes its FINAL shape (it closes the word)."));
  return wrap;
}
function harakatTable() {
  const rows = LETTERS.map((L) => HARAKAT.map((h) => ({ glyph: L.letter + h.mark, speak: L.letter + h.mark })));
  return drillTable(HARAKAT.map((h) => h.name + " (" + h.translit + ")"), rows);
}
function renderHarakat() {
  const wrap = el("div", {});
  wrap.append(el("p", { class: "sound-desc" }, "Short vowels are small marks written above or below a letter — they are not separate letters. Tap any cell to hear it."));
  wrap.append(el("div", { class: "card-grid" }, HARAKAT.map((h) =>
    el("div", { class: "flashcard" }, el("div", { class: "big-letter" }, "ب" + h.mark), el("div", { class: "letter-name" }, h.name), el("div", { class: "letter-translit" }, h.translit), el("div", { class: "sound-desc" }, h.sound)))));
  wrap.append(harakatTable());
  return wrap;
}
function renderTanween() {
  const wrap = el("div", {});
  wrap.append(el("p", { class: "sound-desc" }, "Tanween doubles a short-vowel mark at the end of a word, adding a trailing ‘n’ sound — common on indefinite nouns. Tap any cell to hear it."));
  const rows = LETTERS.map((L) => TANWEEN.map((t) => ({ glyph: L.letter + t.mark, speak: L.letter + t.mark })));
  wrap.append(drillTable(TANWEEN.map((t) => t.name + " (" + t.translit + ")"), rows));
  wrap.append(wordStage("Reading practice", "Real words ending in tanween — the “-un” you just learned.", TANWEEN_WORDS));
  return wrap;
}
function renderMadd() {
  const wrap = el("div", {});
  wrap.append(el("p", { class: "sound-desc" }, "A short vowel followed by its matching letter (ا, و or ي) is held twice as long — a long vowel. Tap any cell to hear it."));
  const rows = LETTERS.filter((l) => !l.nonConnector).map((L) =>
    MADD.map((m) => { const hk = HARAKAT.find((h) => h.id === m.after); const g = L.letter + hk.mark + m.letter; return { glyph: g, speak: g }; }));
  wrap.append(drillTable(MADD.map((m) => m.name + " (" + m.translit + ")"), rows));
  wrap.append(wordStage("Reading practice", "Real words carrying each of the three long vowels — some you've already met.", MADD_WORDS));
  return wrap;
}
function renderSukunShadda() {
  const wrap = el("div", {});
  wrap.append(el("p", { class: "sound-desc" }, "Sukūn (ْ) means “no vowel” — the consonant is cut off short, as it would sound closing a word. Shadda (ّ) doubles the consonant — hold the sound. Tap any cell to hear it."));
  const sukRows = LETTERS.map((L) => [{ glyph: L.letter + SUKUN, speak: L.letter + SUKUN }]);
  wrap.append(el("h4", {}, "Sukūn — the stopped sound"));
  wrap.append(drillTable(["Letter + Sukūn"], sukRows));
  const shRows = LETTERS.map((L) => [{ glyph: L.letter + SHADDA + "َ", speak: L.letter + SHADDA + "َ" }]);
  wrap.append(el("h4", {}, "Shadda — the doubled sound"));
  wrap.append(drillTable(["Letter + Shadda + Fatha"], shRows));
  wrap.append(wordStage("Reading practice", "Real words with sukūn and with shadda, side by side.", SUKUN_SHADDA_WORDS));
  return wrap;
}
function chipList(entries) {
  return el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 18px" },
    entries.map((e) => el("div", { class: "example-word", style: "margin:0" },
      el("span", { class: "w" }, e.letter), playBtn(e.letter, "small"))));
}
function renderTajweed() {
  const wrap = el("div", {});
  wrap.append(el("p", { class: "sound-desc" }, "A first taste of tajweed — the rules that make recitation correct. These categories matter for everything that follows, especially once you start reading the Qur’an."));
  wrap.append(el("h4", {}, "Heavy letters (tafkheem)"));
  wrap.append(el("p", { class: "sound-desc" }, "Pronounced with the back of the tongue pulled up and back, giving a darker, rounder sound. Mnemonic: خُصَّ ضَغْطٍ قِظْ."));
  wrap.append(chipList(LETTERS.filter((l) => l.heavy)));
  wrap.append(el("h4", {}, "Throat letters (ḥalq)"));
  wrap.append(el("p", { class: "sound-desc" }, "Made at the back of the throat. These are also the letters that trigger ‘clear’ (iẕhār) pronunciation of a following noon sākinah."));
  wrap.append(chipList(LETTERS.filter((l) => l.throat)));
  wrap.append(el("h4", {}, "Qalqalah letters"));
  wrap.append(el("p", { class: "sound-desc" }, "When one of these carries a sukūn, give it a little extra ‘bounce’ or echo. Mnemonic: قُطْبُ جَدٍّ."));
  wrap.append(chipList(LETTERS.filter((l) => l.qalqalah)));
  wrap.append(el("h4", {}, "Sun & moon letters"));
  wrap.append(el("p", { class: "sound-desc" }, "Later you’ll meet the definite article ال (‘al-’). Before a ‘sun’ letter its lām is silent and the next letter doubles; before a ‘moon’ letter it’s pronounced normally. Nothing to do yet — just meet the two groups."));
  wrap.append(el("div", { class: "sound-desc" }, el("strong", {}, "Sun: "), ...LETTERS.filter((l) => l.sun).map((l) => l.letter + " ")));
  wrap.append(el("div", { class: "sound-desc" }, el("strong", {}, "Moon: "), ...LETTERS.filter((l) => l.moon).map((l) => l.letter + " ")));
  return wrap;
}
/* ---------------- Reading practice: words, phrases, and live Qur'an text ---------------- */

/* Per letters-lesson reading practice: real words built ONLY from letters introduced in this
 * lesson or earlier ones (cumulative) — so the pool genuinely grows lesson over lesson, same as
 * the letter-groups in ARABIC_CURRICULUM. Lesson 1 only has 5 letters to work with, so its list
 * is intentionally thin; by lesson 6 (all 28 letters) there's enough for real variety. */
const LESSON_READING_WORDS = {
  1: [ // ا ب ت ث ج (5 letters)
    { word: "بَاب", translit: "bāb", meaning: "door" },
  ],
  2: [ // + ح خ د ذ (9 letters)
    { word: "تَاج", translit: "tāj", meaning: "crown" },
    { word: "حُبّ", translit: "ḥubb", meaning: "love" },
    { word: "جَدّ", translit: "jadd", meaning: "grandfather" },
    { word: "دَجَاج", translit: "dajāj", meaning: "chicken" },
    { word: "جَاد", translit: "jād", meaning: "generous" },
    { word: "حَادّ", translit: "ḥādd", meaning: "sharp" },
    { word: "جَذْب", translit: "jadhb", meaning: "pulling / attraction" },
  ],
  3: [ // + ر ز س ش (13 letters)
    { word: "بَرْد", translit: "bard", meaning: "cold" },
    { word: "دَرْس", translit: "dars", meaning: "lesson" },
    { word: "شَجَر", translit: "shajar", meaning: "tree" },
    { word: "سِرّ", translit: "sirr", meaning: "secret" },
    { word: "بَحْر", translit: "baḥr", meaning: "sea" },
    { word: "حَرْب", translit: "ḥarb", meaning: "war" },
    { word: "جِسْر", translit: "jisr", meaning: "bridge" },
    { word: "حُرّ", translit: "ḥurr", meaning: "free" },
    { word: "بَشَر", translit: "bashar", meaning: "humankind" },
    { word: "دَرْب", translit: "darb", meaning: "path" },
    { word: "زُجَاج", translit: "zujāj", meaning: "glass" },
  ],
  4: [ // + ص ض ط ظ (17 letters)
    { word: "صَبْر", translit: "ṣabr", meaning: "patience" },
    { word: "صَدْر", translit: "ṣadr", meaning: "chest" },
    { word: "طَبْخ", translit: "ṭabkh", meaning: "cooking" },
    { word: "حَظّ", translit: "ḥaẓẓ", meaning: "luck" },
    { word: "بَصَر", translit: "baṣar", meaning: "eyesight" },
    { word: "ضَرْب", translit: "ḍarb", meaning: "hitting" },
    { word: "حِرْص", translit: "ḥirṣ", meaning: "eagerness" },
    { word: "ضَجَر", translit: "ḍajar", meaning: "annoyance" },
    { word: "صَخْر", translit: "ṣakhr", meaning: "rock" },
    { word: "حِصَار", translit: "ḥiṣār", meaning: "siege" },
  ],
  5: [ // + ع غ ف ق (21 letters)
    { word: "فَجْر", translit: "fajr", meaning: "dawn (also a prayer name)" },
    { word: "عَصْر", translit: "ʿaṣr", meaning: "afternoon (also a prayer name)" },
    { word: "عَرَب", translit: "ʿarab", meaning: "Arab(s)" },
    { word: "فَرَح", translit: "faraḥ", meaning: "joy" },
    { word: "غَضَب", translit: "ghaḍab", meaning: "anger" },
    { word: "فَقْر", translit: "faqr", meaning: "poverty" },
    { word: "غَرْب", translit: "gharb", meaning: "west" },
    { word: "شَرْق", translit: "sharq", meaning: "east" },
    { word: "فَرْق", translit: "farq", meaning: "difference" },
    { word: "عَرْض", translit: "ʿarḍ", meaning: "width / offer" },
  ],
  6: [ // + ك ل م ن ه و ي — all 28 letters
    { word: "كَلْب", translit: "kalb", meaning: "dog" },
    { word: "قَمَر", translit: "qamar", meaning: "moon" },
    { word: "نَهْر", translit: "nahr", meaning: "river" },
    { word: "لَوْن", translit: "lawn", meaning: "color" },
    { word: "وَجْه", translit: "wajh", meaning: "face" },
    { word: "نَجْم", translit: "najm", meaning: "star" },
    { word: "مَلِك", translit: "malik", meaning: "king" },
    { word: "عِلْم", translit: "ʿilm", meaning: "knowledge" },
    { word: "حَقّ", translit: "ḥaqq", meaning: "truth / right" },
    { word: "جَبَل", translit: "jabal", meaning: "mountain" },
    { word: "نُجُوم", translit: "nujūm", meaning: "stars (plural)" },
    { word: "رَمَل", translit: "raml", meaning: "sand" },
  ],
};

/* Real-word reading practice for the orthography lessons (9-11) — these lessons used to be
 * pure abstract drill tables (every letter × every mark) with no actual words to read. Each
 * one now also shows real words that demonstrate the rule just learned. */
const TANWEEN_WORDS = [
  { word: "وَلَدٌ", translit: "waladun", meaning: "a boy" },
  { word: "بِنْتٌ", translit: "bintun", meaning: "a girl" },
  { word: "كَلْبٌ", translit: "kalbun", meaning: "a dog" },
  { word: "جَبَلٌ", translit: "jabalun", meaning: "a mountain" },
];
const MADD_WORDS = [
  { word: "كِتَاب", translit: "kitāb", meaning: "book (alif madd — ā)" },
  { word: "سَلَام", translit: "salām", meaning: "peace (alif madd — ā)" },
  { word: "نُور", translit: "nūr", meaning: "light (waw madd — ū)" },
  { word: "حُضُور", translit: "ḥuḍūr", meaning: "presence (waw madd — ū)" },
  { word: "كَبِير", translit: "kabīr", meaning: "big (ya madd — ī)" },
  { word: "جَمِيل", translit: "jamīl", meaning: "beautiful (ya madd — ī)" },
];
const SUKUN_SHADDA_WORDS = [
  { word: "بَرْد", translit: "bard", meaning: "cold (sukūn)" },
  { word: "دَرْس", translit: "dars", meaning: "lesson (sukūn)" },
  { word: "فَجْر", translit: "fajr", meaning: "dawn (sukūn)" },
  { word: "حُبّ", translit: "ḥubb", meaning: "love (shadda)" },
  { word: "سِرّ", translit: "sirr", meaning: "secret (shadda)" },
  { word: "حَقّ", translit: "ḥaqq", meaning: "truth (shadda)" },
];
const LESSON_LETTER_COUNT = { 1: 5, 2: 9, 3: 13, 4: 17, 5: 21, 6: 28 };

const TWO_LETTER_WORDS = [
  { word: "لَا", translit: "lā", meaning: "no" },
  { word: "مَا", translit: "mā", meaning: "what" },
  { word: "فِي", translit: "fī", meaning: "in" },
  { word: "لِي", translit: "lī", meaning: "to me / mine" },
  { word: "مَنْ", translit: "man", meaning: "who" },
  { word: "هَلْ", translit: "hal", meaning: "is it / does" },
];
const THREE_LETTER_WORDS = [
  { word: "وَلَد", translit: "walad", meaning: "boy / child" },
  { word: "بِنْت", translit: "bint", meaning: "girl" },
  { word: "سَلَام", translit: "salām", meaning: "peace" },
  { word: "مُعَلِّم", translit: "mu’allim", meaning: "teacher" },
  { word: "كَبِير", translit: "kabīr", meaning: "big" },
  { word: "جَمِيل", translit: "jamīl", meaning: "beautiful" },
  { word: "جَدِيد", translit: "jadīd", meaning: "new" },
];
const PHRASES = [
  { word: "بَيْتٌ كَبِيرٌ", translit: "baytun kabīrun", meaning: "a big house" },
  { word: "قَلَمٌ جَمِيلٌ", translit: "qalamun jamīlun", meaning: "a beautiful pen" },
  { word: "كِتَابٌ جَدِيدٌ", translit: "kitābun jadīdun", meaning: "a new book" },
];
const SENTENCES = [
  { word: "هَذَا بَيْتٌ كَبِيرٌ", translit: "hādhā baytun kabīrun", meaning: "This is a big house." },
  { word: "هَذَا كِتَابٌ جَدِيدٌ", translit: "hādhā kitābun jadīdun", meaning: "This is a new book." },
  { word: "اَلْوَلَدُ فِي الْبَيْتِ", translit: "al-waladu fī al-bayti", meaning: "The boy is in the house." },
  { word: "اَلْبِنْتُ جَمِيلَةٌ", translit: "al-bintu jamīlatun", meaning: "The girl is beautiful." },
  { word: "اَلسَّلَامُ عَلَيْكُمْ", translit: "as-salāmu ʿalaykum", meaning: "Peace be upon you — the standard Muslim greeting." },
];
// Every short surah from the last part of the Qur'an (Juz 'Amma, the part beginners
// traditionally start reciting from) — roughly shortest-first for a gentler ramp. Text itself
// is always fetched live (never hand-typed); only the surah number and a display label are
// hardcoded here. Al-Fātiḥah is last even though it's the single most important surah — by
// the time it comes up, the other 21 have already built up real reading confidence.
const SURAHS = [
  { number: 108, name: "Al-Kawthar" },
  { number: 110, name: "An-Naṣr" },
  { number: 103, name: "Al-ʿAṣr" },
  { number: 112, name: "Al-Ikhlāṣ" },
  { number: 106, name: "Quraysh" },
  { number: 111, name: "Al-Masad" },
  { number: 113, name: "Al-Falaq" },
  { number: 105, name: "Al-Fīl" },
  { number: 97, name: "Al-Qadr" },
  { number: 114, name: "An-Nās" },
  { number: 109, name: "Al-Kāfirūn" },
  { number: 107, name: "Al-Māʿūn" },
  { number: 102, name: "At-Takāthur" },
  { number: 99, name: "Az-Zalzalah" },
  { number: 95, name: "At-Tīn" },
  { number: 94, name: "Ash-Sharḥ" },
  { number: 104, name: "Al-Humazah" },
  { number: 101, name: "Al-Qāriʿah" },
  { number: 100, name: "Al-ʿĀdiyāt" },
  { number: 93, name: "Aḍ-Ḍuḥā" },
  { number: 96, name: "Al-ʿAlaq" },
  { number: 1, name: "Al-Fātiḥah" },
];

function wordCard(entry) {
  const reveal = el("div", { class: "meaning", hidden: "" }, entry.translit + " — " + entry.meaning);
  const btn = el("button", { class: "btn btn-ghost", style: "margin-top:8px;font-size:12px;padding:6px 10px",
    onclick: (e) => { reveal.hidden = !reveal.hidden; e.currentTarget.textContent = reveal.hidden ? "Reveal" : "Hide"; } }, "Reveal");
  return el("div", { class: "flashcard" },
    el("div", { class: "big-letter", style: "font-size:36px" }, entry.word),
    el("div", { style: "text-align:center;margin:8px 0" }, playBtn(entry.word)),
    el("div", { style: "text-align:center" }, reveal, btn));
}
function wordStage(title, intro, entries) {
  const wrap = el("div", {});
  wrap.append(el("h4", {}, title));
  if (intro) wrap.append(el("p", { class: "sound-desc" }, intro));
  wrap.append(el("div", { class: "card-grid" }, entries.map(wordCard)));
  return wrap;
}

/* Live Qur'an text + real reciter audio (Mishary Alafasy) from api.alquran.cloud — never
 * hand-typed: Uthmani script has orthographic details (small waw/noon marks, etc.) that
 * aren't safe to reproduce from memory, so this always fetches the authoritative source. */
const surahCache = new Map();
async function fetchSurah(number) {
  if (surahCache.has(number)) return surahCache.get(number);
  const r = await fetch("https://api.alquran.cloud/v1/surah/" + number + "/editions/quran-uthmani,en.sahih,en.transliteration,ar.alafasy");
  if (!r.ok) throw new Error("surah-" + r.status);
  const j = await r.json();
  const [uth, en, translit, recite] = j.data;
  const ayahs = uth.ayahs.map((a, i) => ({
    number: a.numberInSurah,
    arabic: a.text.replace(/^﻿/, ""),
    translation: en.ayahs[i].text,
    transliteration: translit.ayahs[i].text,
    audio: recite.ayahs[i].audio,
  }));
  const result = { englishName: uth.englishName, meaning: uth.englishNameTranslation, arabicName: uth.name, ayahs };
  surahCache.set(number, result);
  return result;
}
async function playUrl(url, btn) {
  if (btn) { btn.disabled = true; btn.dataset.prevHtml = btn.innerHTML; btn.textContent = "⋯"; }
  try {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    const audio = new Audio(url);
    currentAudio = audio;
    await audio.play();
  } catch (e) {
    toast("Couldn’t play that audio.");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.prevHtml; }
  }
}
function playUrlBtn(url) {
  return el("button", { class: "play-btn", title: "Listen — reciter: Mishary Alafasy", onclick: (e) => playUrl(url, e.currentTarget) }, "▶");
}
function ayahCard(ayah) {
  const reveal = el("div", { class: "meaning", hidden: "" }, ayah.transliteration + " — “" + ayah.translation + "”");
  const btn = el("button", { class: "btn btn-ghost", style: "font-size:12px;padding:6px 10px",
    onclick: (e) => { reveal.hidden = !reveal.hidden; e.currentTarget.textContent = reveal.hidden ? "Reveal" : "Hide"; } }, "Reveal");
  return el("div", { class: "example-word", style: "flex-direction:column;align-items:stretch;gap:10px" },
    el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px" },
      el("div", { class: "w", style: "font-size:24px;line-height:1.8" }, ayah.arabic),
      playUrlBtn(ayah.audio)),
    reveal, btn);
}
function renderSurahReader(container, number) {
  container.replaceChildren(el("div", { class: "empty-note" }, "Loading…"));
  fetchSurah(number).then((s) => {
    container.replaceChildren(
      el("h4", {}, s.englishName + " — “" + s.meaning + "” (" + s.ayahs.length + (s.ayahs.length === 1 ? " ayah" : " ayat") + ")"),
      ...s.ayahs.map(ayahCard),
    );
  }).catch(() => {
    container.replaceChildren(el("div", { class: "empty-note" }, "Couldn’t load this surah right now — check your connection and try again."));
  });
}

function renderWords() {
  const wrap = el("div", {});
  wrap.append(el("p", { class: "sound-desc" }, "Reading practice, step by step: short words first, then phrases, then real verses — read live from the Qur’an, with a real reciter’s audio. Try reading each one yourself before pressing play."));
  wrap.append(wordStage("Two-letter words", "The shortest possible words — mostly tiny, very common ones.", TWO_LETTER_WORDS));
  wrap.append(wordStage("Words you already know", "The example word from every letter so far, all in one place — no hints this time.", LETTERS.map((L) => ({ word: L.example.word, translit: L.example.translit, meaning: L.example.meaning }))));
  wrap.append(wordStage("More three-letter words", null, THREE_LETTER_WORDS));
  wrap.append(wordStage("Simple phrases", "Two words together — a noun and a describing word.", PHRASES));
  wrap.append(wordStage("Simple sentences", "Whole sentences now — the same words and letters, just put together.", SENTENCES));
  wrap.append(el("h4", {}, "Your first surahs"));
  wrap.append(el("p", { class: "sound-desc" }, "The same letters and sounds, now in real Qur’an verses — the shortest, most commonly memorized surahs, read live from an authoritative source with audio from reciter Mishary Alafasy."));
  const tabs = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px" });
  const surahBody = el("div", {});
  SURAHS.forEach((s, i) => {
    const tabBtn = el("button", { class: "btn" + (i === 0 ? " btn-primary" : " btn-ghost"), style: "font-size:13px;padding:8px 14px",
      onclick: (e) => {
        for (const b of tabs.children) b.className = "btn btn-ghost";
        e.currentTarget.className = "btn btn-primary";
        renderSurahReader(surahBody, s.number);
      } }, s.name);
    tabs.append(tabBtn);
  });
  wrap.append(tabs, surahBody);
  renderSurahReader(surahBody, SURAHS[0].number);
  return wrap;
}

function renderLessonBody(lesson) {
  switch (lesson.kind) {
    case "letters": return renderLetters(lesson.ids);
    case "forms": return renderForms();
    case "harakat": return renderHarakat();
    case "tanween": return renderTanween();
    case "madd": return renderMadd();
    case "sukun_shadda": return renderSukunShadda();
    case "tajweed": return renderTajweed();
    case "words": return renderWords();
    default: return el("div", { class: "empty-note" }, "Nothing here yet.");
  }
}

/* ---------------- Navigation / shell ---------------- */
let activeView = { type: "lesson", id: CURRICULUM[0].id };

function renderSidebar() {
  const nav = $("#sidebarNav");
  if (!nav) return;
  nav.replaceChildren();
  const libItem = el("div", { class: "nav-item" + (activeView.type === "library" ? " active" : ""), onclick: () => setView({ type: "library" }) },
    el("span", { class: "dot" }), "Letters Library");
  nav.append(el("div", { class: "sidebar-section" }, el("h3", {}, "Reference"), libItem));

  const lessonItems = CURRICULUM.map((lesson) => {
    const done = !!progress.completed[lesson.id];
    const active = activeView.type === "lesson" && activeView.id === lesson.id;
    return el("div", { class: "nav-item" + (active ? " active" : "") + (done ? " done" : ""), onclick: () => setView({ type: "lesson", id: lesson.id }) },
      el("span", { class: "num" }, done ? "✓" : lesson.id), lesson.title);
  });
  nav.append(el("div", { class: "sidebar-section" }, el("h3", {}, "Foundations"), lessonItems));
}

function setView(view) {
  activeView = view;
  renderSidebar();
  renderMain();
  $("#sidebar").classList.remove("open");
  window.scrollTo(0, 0);
}

function renderMain() {
  const app = $("#app");
  app.replaceChildren();
  if (activeView.type === "library") {
    app.append(el("div", { class: "lesson-title" }, "Letters Library"));
    app.append(el("div", { class: "lesson-sub" }, "All 28 letters, any time."));
    app.append(el("div", { class: "card-grid" }, LETTERS.map(letterCard)));
    return;
  }
  const lesson = CURRICULUM.find((l) => l.id === activeView.id);
  app.append(el("div", { class: "lesson-title" }, "Lesson " + lesson.id + ": " + lesson.title));
  app.append(el("div", { class: "lesson-sub" }, progress.completed[lesson.id] ? "Completed — revisit any time." : "Work through it, then mark it done."));
  app.append(renderLessonBody(lesson));
  if (lesson.kind === "letters" && LESSON_READING_WORDS[lesson.id]) {
    const n = LESSON_LETTER_COUNT[lesson.id];
    const intro = lesson.id === 1
      ? "Only " + n + " letters so far, so there's just one real word you can already sound out — but it's a real one. More letters, more words, starting next lesson."
      : "Every word below uses only letters you've learned so far (" + n + " of 28) — try reading each one yourself before revealing it.";
    app.append(wordStage("Reading practice", intro, LESSON_READING_WORDS[lesson.id]));
  }
  const nextLesson = CURRICULUM.find((l) => l.id === lesson.id + 1);
  const actions = el("div", { class: "lesson-actions" });
  if (!progress.completed[lesson.id]) actions.append(el("button", { class: "btn btn-primary", onclick: () => markDone(lesson.id) }, "Mark lesson done"));
  if (nextLesson) actions.append(el("button", { class: "btn btn-ghost", onclick: () => setView({ type: "lesson", id: nextLesson.id }) }, "Next: " + nextLesson.title + " →"));
  app.append(actions);
}

/* ---------------- AI Teacher chat ---------------- */
let chatMessages = [];
let chatOpen = false;
function currentContext() {
  if (activeView.type === "library") return "Browsing the full letters library.";
  const lesson = CURRICULUM.find((l) => l.id === activeView.id);
  return "Lesson " + lesson.id + " of 13 (Arabic Foundations): " + lesson.title + ".";
}
function renderChat() {
  const panel = $("#teacherPanel");
  panel.replaceChildren();
  panel.append(el("button", { class: "fab", title: "Ask the teacher", onclick: () => { chatOpen = !chatOpen; renderChat(); } }, "?"));
  if (!chatOpen) return;
  const list = el("div", { class: "chat-messages" });
  for (const m of chatMessages) list.append(el("div", { class: "msg " + m.role }, m.content));
  if (!chatMessages.length) list.append(el("div", { class: "empty-note" }, "Ask about anything — a letter, a sound, a word, or just say hi in Arabic."));
  const typing = el("div", { class: "chat-typing", hidden: "" }, "Teacher is typing…");
  const input = el("input", { type: "text", placeholder: "Type a message…" });
  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    chatMessages.push({ role: "user", content: text });
    list.append(el("div", { class: "msg user" }, text));
    list.scrollTop = list.scrollHeight;
    typing.hidden = false;
    try {
      const headers = { "content-type": "application/json", ...(await authHeader()) };
      const r = await fetch("/api/tutor", {
        method: "POST", headers,
        body: JSON.stringify({ mode: "chat", messages: chatMessages.slice(-16), context: currentContext() }),
      });
      const data = await r.json();
      const reply = data.reply || "Sorry, I couldn’t answer that just now.";
      chatMessages.push({ role: "assistant", content: reply });
      list.append(el("div", { class: "msg assistant" }, reply));
    } catch (e) {
      list.append(el("div", { class: "msg assistant" }, "I couldn’t reach the server — check your connection."));
    }
    typing.hidden = true;
    list.scrollTop = list.scrollHeight;
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  const win = el("div", { class: "chat-window" },
    el("div", { class: "chat-head" }, "AI Teacher", el("button", { class: "icon-btn", onclick: () => { chatOpen = false; renderChat(); } }, "✕")),
    list, typing,
    el("div", { class: "chat-input-row" }, input, el("button", { onclick: send }, "→")));
  panel.append(win);
  setTimeout(() => (list.scrollTop = list.scrollHeight), 0);
}

/* ---------------- App shell mount ---------------- */
let mounted = false;
function mountApp() {
  loadLocalProgress();
  syncProgressFromCloud();
  $("#appShell").hidden = false;
  if (!mounted) {
    mounted = true;
    $("#signOutBtn").addEventListener("click", () => signOut(auth));
    $("#themeBtn").addEventListener("click", toggleTheme);
    $("#menuBtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  }
  renderSidebar();
  renderMain();
  renderChat();
}

document.addEventListener("DOMContentLoaded", boot);

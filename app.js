/* Arabic Foundations — personal course engine. Single owner account, no
 * student/teacher/admin machinery: just sign in, learn, and talk to the AI
 * teacher. shared/firebase.js points at the same Firebase project as
 * truck-talk-webapp (truck-talk-admin) on purpose, for one continuous
 * account/progress history — this is otherwise a fully separate app/repo/
 * deployment from truck-talk-webapp.
 */
import { auth, db, googleProvider, isFirebaseConfigured, usesRedirectSignIn } from "./shared/firebase.js";
import { OWNER_EMAIL } from "./shared/firebase-config.js";
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
    el("p", { class: "signin-denied" }, "Signed in as " + (email || "this account") + ". This course is just for its owner."),
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
    if (user.email !== OWNER_EMAIL) { currentUser = null; renderDenied(user.email); return; }
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
function writingBox(entry) {
  const canvas = el("canvas", { class: "trace-canvas", width: "360", height: "180" });
  const ctx = canvas.getContext("2d");
  function drawGuide() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.direction = "rtl";
    ctx.font = "120px 'Noto Naskh Arabic', serif";
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--line") || "#ddd";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(entry.letter, canvas.width / 2, canvas.height / 2 + 10);
    ctx.restore();
  }
  drawGuide();
  let drawing = false, lastX = 0, lastY = 0;
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width, scaleY = canvas.height / r.height;
    return [(e.clientX - r.left) * scaleX, (e.clientY - r.top) * scaleY];
  }
  canvas.addEventListener("pointerdown", (e) => { drawing = true; [lastX, lastY] = pos(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink") || "#111";
    ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(x, y); ctx.stroke();
    [lastX, lastY] = [x, y];
  });
  canvas.addEventListener("pointerup", () => (drawing = false));
  const feedback = el("div", { class: "writing-feedback", hidden: "" });
  const checkBtn = el("button", { class: "btn btn-primary", onclick: async () => {
    checkBtn.disabled = true; checkBtn.textContent = "Checking…";
    feedback.hidden = true;
    try {
      const headers = { "content-type": "application/json", ...(await authHeader()) };
      const r = await fetch("/api/tutor", {
        method: "POST", headers,
        body: JSON.stringify({ mode: "writing", letter: entry.name + " (" + entry.letter + ")", image: canvas.toDataURL("image/png") }),
      });
      const data = await r.json();
      feedback.textContent = data.reply || "Couldn’t check that just now — try again in a moment.";
    } catch (e) {
      feedback.textContent = "Couldn’t reach the teacher just now — check your connection and try again.";
    }
    feedback.hidden = false;
    checkBtn.disabled = false; checkBtn.textContent = "Check my writing";
  } }, "Check my writing");
  const clearBtn = el("button", { class: "btn btn-ghost", onclick: drawGuide }, "Clear");
  return el("div", { class: "writing-box" },
    el("h4", {}, "Trace " + entry.name + " — then try freehand"),
    canvas,
    el("div", { class: "writing-actions" }, clearBtn, checkBtn),
    feedback,
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
  return wrap;
}
function renderMadd() {
  const wrap = el("div", {});
  wrap.append(el("p", { class: "sound-desc" }, "A short vowel followed by its matching letter (ا, و or ي) is held twice as long — a long vowel. Tap any cell to hear it."));
  const rows = LETTERS.filter((l) => !l.nonConnector).map((L) =>
    MADD.map((m) => { const hk = HARAKAT.find((h) => h.id === m.after); const g = L.letter + hk.mark + m.letter; return { glyph: g, speak: g }; }));
  wrap.append(drillTable(MADD.map((m) => m.name + " (" + m.translit + ")"), rows));
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
function renderWords() {
  const wrap = el("div", { class: "card-grid" });
  for (const L of LETTERS) {
    const reveal = el("div", { class: "meaning", hidden: "" }, L.example.translit + " — " + L.example.meaning);
    const btn = el("button", { class: "btn btn-ghost", style: "margin-top:8px;font-size:12px;padding:6px 10px", onclick: (e) => { reveal.hidden = !reveal.hidden; e.currentTarget.textContent = reveal.hidden ? "Reveal" : "Hide"; } }, "Reveal");
    wrap.append(el("div", { class: "flashcard" },
      el("div", { class: "big-letter", style: "font-size:40px" }, L.example.word),
      el("div", { style: "text-align:center;margin:8px 0" }, playBtn(L.example.word)),
      el("div", { style: "text-align:center" }, reveal, btn)));
  }
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
  if (lesson.kind === "letters") {
    app.append(el("h4", {}, "Writing practice"));
    for (const id of lesson.ids) app.append(writingBox(byId(id)));
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

/* Shared by api/tutor.js and api/tts.js: "is this caller the owner?". This app has exactly
 * one user, so a valid Firebase ID token whose email matches OWNER_EMAIL is the whole check;
 * no database read needed (unlike truck-talk-webapp's own api/_auth.js, which checks a
 * student's course-access status — a different, unrelated project).
 * (Files starting with an underscore are not served as endpoints by Vercel.) */
"use strict";

const FIREBASE_WEB_KEY = "AIzaSyBGzEpwBGARclSzSuiE5o1HZB-WXp7Ikvg";
const OWNER_EMAIL = "abdujalilov7707@gmail.com";
const DAY_MS = 24 * 60 * 60 * 1000;

const verified = new Map();   // ID token -> { uid, ok, until }

// uid when the token is real and belongs to the owner; null otherwise (unreachable Firebase counts as "no")
async function checkOwner(token, now) {
  const hit = verified.get(token);
  if (hit && hit.until > now) return hit.ok ? hit.uid : null;
  try {
    const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_WEB_KEY, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token }),
    });
    if (!r.ok) return null;
    const user = (((await r.json()).users) || [])[0] || {};
    const ok = !!user.localId && user.email === OWNER_EMAIL;
    verified.set(token, { uid: user.localId, ok, until: now + 5 * 60 * 1000 });
    if (verified.size > 200) verified.clear();
    return ok ? user.localId : null;
  } catch (e) { return null; }
}

// A per-person rate limiter (best effort on serverless: each server instance counts separately) —
// mainly a bug/runaway-loop guard here, since the only caller is the owner.
function makeLimiter({ perWindow, windowMs, perDay }) {
  const hits = new Map();
  return function underLimit(uid, now) {
    const list = (hits.get(uid) || []).filter((t) => now - t < DAY_MS);
    const recent = list.filter((t) => now - t < windowMs).length;
    if (recent >= perWindow || list.length >= perDay) { hits.set(uid, list); return false; }
    list.push(now); hits.set(uid, list);
    if (hits.size > 50) hits.clear();
    return true;
  };
}

module.exports = { checkOwner, makeLimiter, OWNER_EMAIL };

/* Firebase app init — single source of truth, imported by auth-gate.js,
 * app.js's cloud sync bridge, and admin/admin.js. */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, GoogleAuthProvider, OAuthProvider,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getDatabase, goOffline, goOnline } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

export const isFirebaseConfigured = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");

// Inside a Capacitor native app, window.Capacitor is injected by the native
// bridge itself (no import needed to detect it). Plain getAuth()'s automatic
// persistence detection doesn't behave on either native platform, so both
// need initializeAuth() with an explicit persistence — see shared/README
// notes in auth-gate.js's native sign-in path for why this pairs with the
// native Google Sign-In bridge.
//
// The two platforms need different persistence, though: Android's WebView
// doesn't reliably survive app restarts with the plain browser (localStorage)
// persistence, so it needs indexedDBLocalPersistence. iOS's WKWebView serves
// the app over a custom `capacitor://` scheme (not http/https), and
// initializeAuth's IndexedDB-based persistence throws inside the SDK under
// that non-http origin, producing a blank screen — browserLocalPersistence
// avoids that code path and works fine there.
const platform = typeof window !== "undefined" && window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform();
const nativePersistence = platform === "android" ? indexedDBLocalPersistence : platform === "ios" ? browserLocalPersistence : null;

// Browsers partition storage between the site and Firebase's own sign-in
// domain (iOS Safari always, desktop Safari/Chrome when third-party storage
// is blocked), so the popup can't hand the result back and sign-in ends as
// "cancelled" or "missing initial state". The fix is to serve Firebase's
// /__/auth/* handler from the app's own domain (vercel.json proxies it, and
// the redirect URI is registered on the OAuth web client) and use a
// full-page redirect rather than a popup. Other hosts (localhost, previews,
// the admin site) keep the plain popup on the default auth domain.
const PROXIED_AUTH_HOSTS = ["truck-talk-webapp.vercel.app"];
export const usesRedirectSignIn = !nativePersistence &&
  typeof location !== "undefined" && PROXIED_AUTH_HOSTS.includes(location.hostname);

const activeConfig = usesRedirectSignIn
  ? { ...firebaseConfig, authDomain: location.host }
  : firebaseConfig;

const app = isFirebaseConfigured
  ? (getApps().length ? getApps()[0] : initializeApp(activeConfig))
  : null;

export const auth = app
  ? (nativePersistence ? initializeAuth(app, { persistence: nativePersistence }) : getAuth(app))
  : null;
export const db = app ? getDatabase(app) : null;

export const googleProvider = new GoogleAuthProvider();
export const appleProvider = new OAuthProvider("apple.com");

/* A Realtime Database connection counts against the plan's "simultaneous connections" limit (100 on
 * the free Spark plan) for as long as the page keeps it open — including a phone that's been left in a
 * background tab. keepConnectionLean() lets go of the connection once the page has been hidden for
 * `idleMs` (after `beforeIdle()` — the gates flush any unsaved progress there) and reconnects the moment
 * the page is visible again; the listeners resync by themselves. Only the student course pages use it —
 * never the teacher live-class pages, whose host must stay connected. */
let leanOn = false;
export function keepConnectionLean({ idleMs = 120000, beforeIdle = null, afterWake = null } = {}){
  if (!db || leanOn || typeof document === "undefined") return;
  leanOn = true;
  let timer = null, offline = false;
  const goIdle = async () => {
    if (document.visibilityState !== "hidden") return;
    try{ if (beforeIdle) await Promise.race([Promise.resolve(beforeIdle()), new Promise((r) => setTimeout(r, 4000))]); }catch(e){}
    if (document.visibilityState === "hidden"){ offline = true; try{ goOffline(db); }catch(e){} }
  };
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (document.visibilityState === "hidden") timer = setTimeout(goIdle, idleMs);
    else if (offline){ offline = false; try{ goOnline(db); }catch(e){} if (afterWake) try{ afterWake(); }catch(e){} }
  });
}

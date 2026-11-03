/* Firebase project configuration.
 *
 * Backend is Firebase Authentication + Realtime Database — chosen
 * specifically because Realtime Database works on the free Spark plan
 * with no billing account required (unlike Firestore, which now requires
 * upgrading to the Blaze plan just to create a database, even to stay
 * within its free tier).
 *
 * These values are not secret — they identify your project, not authorize
 * access to it. Real access control lives in database.rules.json, not here.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyBGzEpwBGARclSzSuiE5o1HZB-WXp7Ikvg",
  authDomain: "truck-talk-admin.firebaseapp.com",
  databaseURL: "https://truck-talk-admin-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "truck-talk-admin",
  storageBucket: "truck-talk-admin.firebasestorage.app",
  messagingSenderId: "255238093542",
  appId: "1:255238093542:web:4cfb42bdf8e1b0b7dd9927",
};

/* The single owner account. Auto-approved as "owner" on first sign-in,
 * bypassing the request queue. Also checked independently in
 * database.rules.json — that server-side copy is the real security
 * boundary, this one is just so the client UI knows to skip the request
 * screen. */
export const OWNER_EMAIL = "abdujalilov7707@gmail.com";

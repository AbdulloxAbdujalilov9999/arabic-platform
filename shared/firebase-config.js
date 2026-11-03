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

/* Accounts allowed into this private app. Checked here (client UI gate) and
 * independently in api/_auth.js (the real security boundary for the AI
 * teacher/voice endpoints — this copy alone wouldn't stop anyone, since
 * it's just client-side JS). database.rules.json doesn't list emails at
 * all; it's scoped per signed-in uid, so any signed-in account already
 * only ever sees its own progress regardless of this list. */
export const ALLOWED_EMAILS = ["abdujalilov7707@gmail.com", "saidamusaxonova9@gmail.com"];

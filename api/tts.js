/* Arabic native-voice endpoint (Vercel serverless function). Owner-only — see _auth.js.
 *
 *   GET /api/tts?t=<Arabic text>   -> audio/mpeg   (needs the owner's Firebase ID token)
 *   GET /api/tts?health=1          -> { configured }   (never reveals a key)
 *
 * Unlike api/tts.js (public, but restricted to a fixed, pre-built phrase list because it serves
 * many students on a cost-sensitive plan) this serves one person learning Arabic, so the content
 * is open text rather than a whitelist. Access is token-gated instead, and caching is browser-only
 * (no shared/CDN cache) so a cached response can never be replayed without a valid token.
 *   ELEVENLABS_API_KEY        required
 *   ELEVENLABS_ARABIC_VOICE   required — a voice id from your ElevenLabs Voice Library (pick one
 *                             tagged Arabic; ideally a clear, formal reciter-style voice)
 *   ELEVENLABS_ARABIC_MODEL   optional (default eleven_v4)
 */
"use strict";

const { checkOwner, makeLimiter } = require("./_auth.js");
const LIMITS = { perWindow: 120, windowMs: 10 * 60 * 1000, perDay: 3000 };
const underLimit = makeLimiter(LIMITS);

function normalize(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

function send(res, status, headers, body) {
  res.statusCode = status;
  for (const k of Object.keys(headers)) res.setHeader(k, headers[k]);
  res.end(body);
}
const json = (res, status, obj) => send(res, status, { "content-type": "application/json", "cache-control": "no-store" }, JSON.stringify(obj));

function synth(env, text) {
  const voice = env.ELEVENLABS_ARABIC_VOICE;
  return fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voice) + "?output_format=mp3_44100_64", {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: env.ELEVENLABS_ARABIC_MODEL || "eleven_v4",
      language_code: "ar",
      voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0, use_speaker_boost: true },
    }),
  });
}

async function handler(req, res) {
  const env = process.env;
  const now = Date.now();
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  if (q.health) return json(res, 200, { configured: !!(env.ELEVENLABS_API_KEY && env.ELEVENLABS_ARABIC_VOICE) });
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method" });

  const authHeader = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return json(res, 401, { error: "sign-in" });
  const uid = await checkOwner(token, now);
  if (!uid) return json(res, 403, { error: "not-allowed" });
  if (!underLimit(uid, now)) return json(res, 429, { error: "slow-down" });

  const text = normalize(q.t);
  if (!text || text.length > 400) return json(res, 400, { error: "bad-text" });
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_ARABIC_VOICE) return json(res, 503, { error: "not-configured" });

  let up;
  try { up = await synth(env, text); } catch (e) { return json(res, 503, { error: "upstream-unreachable" }); }
  if (!up.ok) return json(res, 503, { error: "upstream-" + up.status });
  const audio = Buffer.from(await up.arrayBuffer());
  if (!audio.length) return json(res, 503, { error: "empty-audio" });
  send(res, 200, {
    "content-type": "audio/mpeg",
    "content-length": String(audio.length),
    "cache-control": "private, max-age=604800", // browser-only cache; never shared, so auth can't be bypassed via a cached hit
  }, audio);
}

module.exports = handler;

// 비밀번호 로그인
// .env(또는 인터넷 서버 설정)에 APP_PASSWORD 가 있으면 로그인이 켜집니다. 없으면 로그인 없이 열려요(내 컴퓨터에서만 쓸 때).
import crypto from "node:crypto";

const PASSWORD = process.env.APP_PASSWORD || "";
export const authEnabled = PASSWORD.length > 0;

const sha = (s) => crypto.createHash("sha256").update(s).digest();
// 로그인 증표(쿠키 값): 비밀번호에서 만들어서, 비밀번호를 바꾸면 모두 로그아웃돼요.
const TOKEN = authEnabled ? crypto.createHmac("sha256", "money-chat-session-v1").update(PASSWORD).digest("hex") : "";

function safeEqual(a, b) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function getCookie(req, name) {
  const hit = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}

export function isAuthed(req) {
  return !authEnabled || safeEqual(getCookie(req, "money_session"), TOKEN);
}

// 비밀번호를 계속 틀리는 걸 막기: IP 하나당 15분에 8번까지
const tries = new Map();
function tooMany(ip) {
  const now = Date.now();
  const t = tries.get(ip);
  if (!t || t.resetAt < now) {
    tries.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  t.count++;
  return t.count > 8;
}

export function loginHandler(req, res) {
  if (tooMany(req.ip)) return res.status(429).json({ error: "너무 많이 틀렸어요. 15분 뒤에 다시 해줘" });
  const given = String(req.body?.password || "");
  if (!authEnabled || !crypto.timingSafeEqual(sha(given), sha(PASSWORD))) {
    return res.status(401).json({ error: "비밀번호가 달라요" });
  }
  tries.delete(req.ip);
  const secure = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `money_session=${TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`);
  res.json({ ok: true });
}

// 로그인 안 해도 열리는 주소 (로그인 화면에 필요한 것들)
const PUBLIC_PATHS = new Set(["/login.html", "/style.css", "/icon.svg", "/manifest.json", "/sw.js", "/api/login", "/api/ping"]);

export function requireLogin(req, res, next) {
  if (isAuthed(req) || PUBLIC_PATHS.has(req.path)) return next();
  if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) {
    return res.status(401).json({ error: "로그인이 필요해요" });
  }
  res.redirect("/login.html");
}

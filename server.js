// 머니 – 채팅 가계부 서버
import "./lib/env.js";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import db, { save, nextId, dateKey, UPLOAD_DIR } from "./lib/db.js";
import { localParse } from "./public/shared/localParser.js";
import { aiEnabled, aiProvider, aiParseText, aiParseImage } from "./lib/ai.js";
import { getStats } from "./lib/stats.js";
import { authEnabled, loginHandler, requireLogin } from "./lib/auth.js";
import { startReminder, vapidPublicKey, sendPushToAll, reminderText } from "./lib/reminder.js";

const PORT = Number(process.env.PORT || 3000);

// 인터넷에 올리면 비밀번호 없이 열리지 않도록: 서버(production)에서 APP_PASSWORD 가 없으면 아예 시작하지 않음
if (process.env.NODE_ENV === "production" && !authEnabled) {
  console.error("APP_PASSWORD 가 설정되지 않았어요. 인터넷 서버에서는 비밀번호가 꼭 필요해서 시작하지 않을게요.");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1); // 인터넷 서버(프록시) 뒤에서도 https 인지 알아보기
app.use(express.json({ limit: "15mb" }));
app.get("/api/ping", (req, res) => res.json({ mode: "server" })); // 화면이 '서버가 있는지' 확인하는 용도
app.post("/api/login", loginHandler);
app.use(requireLogin);
app.use(express.static("public"));
app.use("/uploads", express.static(UPLOAD_DIR));

const won = (n) => n.toLocaleString("ko-KR") + "원";

// 처음 실행하면 인사 메시지
if (db.messages.length === 0) {
  db.messages.push({
    id: nextId(),
    role: "bot",
    ts: Date.now(),
    text: "안녕! 나는 머니야 👋\n돈 쓰거나 들어오면 그냥 말해줘.\n예) 스타벅스 5800 / 점심 김밥 4천원 / 월급 300만원 들어옴",
  });
  db.messages.push({ id: nextId(), role: "bot", ts: Date.now(), text: "매일 밤 9시에 내가 먼저 물어봐도 될까?", askNotify: true });
  if (new Date().getHours() >= 21) db.meta.lastReminderDate = dateKey();
  save();
}

function addMessage(msg) {
  const m = { id: nextId(), ts: Date.now(), ...msg };
  db.messages.push(m);
  return m;
}

// 해석 결과를 기록으로 저장하고 답장 말풍선을 만든다
function applyResult(result, fallbackReply) {
  const today = dateKey();
  const saved = [];
  if (result.kind === "record") {
    for (const it of result.items) {
      if (!it.amount || it.amount <= 0) continue;
      const entry = {
        id: nextId(),
        type: it.type,
        place: it.place.trim() || (it.type === "income" ? "수입" : "지출"),
        amount: Math.round(it.amount),
        category: it.category,
        memo: it.memo || "",
        date: /^\d{4}-\d{2}-\d{2}$/.test(it.date || "") ? it.date : today,
        createdAt: Date.now(),
      };
      db.entries.push(entry);
      saved.push(entry);
    }
  }

  let text = result.reply;
  if (!text) {
    if (saved.length) {
      text = saved
        .map((e) => (e.type === "income" ? `${e.place} ${won(e.amount)} 들어왔구나! 💰` : `${e.place}에서 ${won(e.amount)} 썼구나, 기록했어 ✍️`))
        .join("\n");
    } else if (result.kind === "none_today") {
      text = "오늘은 무지출 데이구나! 멋져 👏";
    } else {
      text = fallbackReply;
    }
  }
  return addMessage({ role: "bot", text, entryIds: saved.map((e) => e.id) });
}

const HELP = "음, 금액을 못 찾았어 🤔 \"어디서 얼마\" 처럼 말해줄래? 예) 편의점 3200";

// ---------- API ----------

app.get("/api/messages", (req, res) => {
  const after = Number(req.query.after || 0);
  const list = after ? db.messages.filter((m) => m.id > after) : db.messages.slice(-200);
  res.json({ aiEnabled, messages: list.map(withEntries) });
});

function withEntries(m) {
  const entryMap = Object.fromEntries(db.entries.map((e) => [e.id, e]));
  return { ...m, entries: (m.entryIds || []).map((id) => entryMap[id]).filter(Boolean) };
}

// 글로 입력
app.post("/api/chat", async (req, res) => {
  const text = String(req.body.text || "").trim();
  if (!text) return res.status(400).json({ error: "빈 메시지" });
  const userMsg = addMessage({ role: "user", text });

  let result;
  if (aiEnabled) {
    try {
      result = await aiParseText(text, dateKey());
    } catch (e) {
      console.error("AI 해석 실패, 간단 해석기로 대신할게요:", e.message);
    }
  }
  if (!result) result = localParse(text);

  const botMsg = applyResult(result, HELP);
  save();
  res.json({ messages: [withEntries(userMsg), withEntries(botMsg)] });
});

// 사진(영수증/결제내역) 보내기
app.post("/api/photo", async (req, res) => {
  const { dataUrl, caption } = req.body;
  const m = /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl || "");
  if (!m) return res.status(400).json({ error: "사진 형식을 알 수 없어요" });
  const [, mediaType, ext, base64] = m;
  const file = `${Date.now()}.${ext === "jpeg" ? "jpg" : ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(base64, "base64"));
  const userMsg = addMessage({ role: "user", image: `/uploads/${file}`, text: caption || "" });

  let botMsg;
  if (!aiEnabled) {
    botMsg = addMessage({
      role: "bot",
      text: "사진을 읽으려면 AI 열쇠(API 키)가 필요해 🔑\n지금은 \"가게 이름 금액\"으로 적어줄래?",
    });
  } else {
    try {
      const result = await aiParseImage(base64, mediaType, caption, dateKey());
      botMsg = applyResult(result, "사진에서 금액을 못 찾았어 😢 얼마였는지 적어줄래?");
    } catch (e) {
      console.error("사진 인식 실패:", e.message);
      botMsg = addMessage({ role: "bot", text: "사진을 읽다가 문제가 생겼어 😢 글로 적어줄래?" });
    }
  }
  save();
  res.json({ messages: [withEntries(userMsg), withEntries(botMsg)] });
});

// 기록 되돌리기(삭제)
app.delete("/api/entries/:id", (req, res) => {
  const id = Number(req.params.id);
  const before = db.entries.length;
  db.entries = db.entries.filter((e) => e.id !== id);
  if (db.entries.length === before) return res.status(404).json({ error: "없는 기록" });
  save();
  res.json({ ok: true });
});

app.get("/api/stats", (req, res) => {
  res.json(getStats(req.query.period, Number(req.query.offset || 0)));
});

// 알림
app.get("/api/push/key", (req, res) => res.json({ key: vapidPublicKey }));

app.post("/api/push/subscribe", (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: "잘못된 구독" });
  if (!db.subscriptions.some((s) => s.endpoint === sub.endpoint)) db.subscriptions.push(sub);
  save();
  res.json({ ok: true });
});

app.post("/api/push/test", async (req, res) => {
  await sendPushToAll(reminderText());
  res.json({ ok: true, count: db.subscriptions.length });
});

app.listen(PORT, () => {
  console.log("");
  console.log("  💬 머니가 준비됐어요!");
  console.log(`  브라우저에서 열기 → http://localhost:${PORT}`);
  console.log(`  로그인: ${authEnabled ? "켜짐 🔒" : "꺼짐 (내 컴퓨터에서만 쓰는 중)"}`);
  console.log(`  AI(문장 이해): ${aiEnabled ? `켜짐 ✅ (${aiProvider === "gemini" ? "구글 Gemini" : "Claude"})` : "꺼짐 (.env 에 API 키를 넣으면 켜져요)"}`);
  console.log("  끄려면 이 창에서 Control + C");
  console.log("");
  startReminder();
});

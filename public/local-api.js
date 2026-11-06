// 서버 없이 동작하는 모드: 기록을 이 폰(브라우저) 안에 저장합니다.
// 화면(app.js)은 그대로 두고, /api/... 요청만 여기서 대신 처리해요.
import { localParse } from "/shared/localParser.js";
import { computeStats, dateKey } from "/shared/statsCore.js";
import { answerQuery } from "/shared/chatQuery.js";

const KEY = "money-chat-db-v1";
const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
const HELP = "음, 금액을 못 찾았어 🤔 \"어디서 얼마\" 처럼 말해줄래? 예) 편의점 3200\n쓴 돈이 궁금하면 \"이번 주 얼마 썼어?\" 하고 물어봐!";

const empty = () => ({ messages: [], entries: [], meta: { lastReminderDate: null, nextId: 1 } });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch {}
  return empty();
}

let db = load();
let saveFailed = false;

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    saveFailed = false;
  } catch {
    saveFailed = true; // 사생활 보호 모드 등: 저장이 안 될 수 있음
  }
}

const nextId = () => db.meta.nextId++;

function addMessage(msg) {
  const m = { id: nextId(), ts: Date.now(), ...msg };
  db.messages.push(m);
  return m;
}

function withEntries(m) {
  const map = Object.fromEntries(db.entries.map((e) => [e.id, e]));
  return { ...m, entries: (m.entryIds || []).map((id) => map[id]).filter(Boolean) };
}

// 처음 열면 인사 말풍선
function greet() {
  if (db.messages.length) return;
  addMessage({
    role: "bot",
    text: "안녕! 나는 머니야 👋\n돈 쓰거나 들어오면 그냥 말해줘.\n예) 스타벅스 5800 / 점심 김밥 4천원 / 월급 300만원 들어옴\n궁금하면 \"오늘 얼마 썼어?\" 하고 물어봐도 돼!",
  });
  addMessage({ role: "bot", text: "밤 9시 넘어서 앱을 열면 내가 먼저 물어볼게! 🌙" });
  if (new Date().getHours() >= 21) db.meta.lastReminderDate = dateKey();
  save();
}

// 밤 9시 이후 처음 열었을 때 머니가 먼저 말을 건다
function reminderTick() {
  const now = new Date();
  const today = dateKey(now);
  if (now.getHours() < 21 || db.meta.lastReminderDate === today) return;
  db.meta.lastReminderDate = today;
  const count = db.entries.filter((e) => e.date === today).length;
  addMessage({
    role: "bot",
    reminder: true,
    text: count === 0 ? "오늘 하루 어땠어? 쓴 돈이나 들어온 돈 있으면 알려줘 💬" : `오늘 ${count}건 기록했어! 혹시 빠뜨린 거 없어? 💬`,
  });
  save();
}

function applyResult(result) {
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
        date: today,
        createdAt: Date.now(),
      };
      db.entries.push(entry);
      saved.push(entry);
    }
  }
  let text;
  if (saved.length) {
    text = saved
      .map((e) => (e.type === "income" ? `${e.place} ${won(e.amount)} 들어왔구나! 💰` : `${e.place}에서 ${won(e.amount)} 썼구나, 기록했어 ✍️`))
      .join("\n");
  } else if (result.kind === "none_today") {
    text = "오늘은 무지출 데이구나! 멋져 👏";
  } else {
    text = HELP;
  }
  if (saveFailed) text += "\n\n⚠️ 이 브라우저에서는 기록이 저장되지 않을 수 있어. 사생활 보호 모드면 꺼줘.";
  return addMessage({ role: "bot", text, entryIds: saved.map((e) => e.id) });
}

// ---- /api/... 흉내 ----
function route(method, url, body) {
  const p = url.pathname;
  if (method === "GET" && p === "/api/messages") {
    reminderTick();
    const after = Number(url.searchParams.get("after") || 0);
    const list = after ? db.messages.filter((m) => m.id > after) : db.messages.slice(-200);
    return { body: { aiEnabled: false, messages: list.map(withEntries) } };
  }
  if (method === "POST" && p === "/api/chat") {
    const text = String(body.text || "").trim();
    if (!text) return { status: 400, body: { error: "빈 메시지" } };
    const userMsg = addMessage({ role: "user", text });
    const parsed = localParse(text);
    // 질문이면("나 오늘 얼마 썼어?") 저장된 기록으로 바로 답한다. 금액이 들어간 문장은 기록이 우선.
    const answer = parsed.kind === "record" ? null : answerQuery(text, db.entries);
    const botMsg = answer ? addMessage({ role: "bot", text: answer }) : applyResult(parsed);
    save();
    return { body: { messages: [withEntries(userMsg), withEntries(botMsg)] } };
  }
  if (method === "DELETE" && p.startsWith("/api/entries/")) {
    const id = Number(p.split("/").pop());
    const before = db.entries.length;
    db.entries = db.entries.filter((e) => e.id !== id);
    if (db.entries.length === before) return { status: 404, body: { error: "없는 기록" } };
    save();
    return { body: { ok: true } };
  }
  if (method === "GET" && p === "/api/stats") {
    return { body: computeStats(db.entries, url.searchParams.get("period") || "month", Number(url.searchParams.get("offset") || 0)) };
  }
  // 사진·푸시 알림은 서버가 필요해서 이 모드에서는 지원하지 않아요
  return { status: 404, body: { error: "이 모드에서는 지원하지 않아요" } };
}

// ---- 백업 ----
async function exportBackup() {
  const file = new File([JSON.stringify(db, null, 2)], `머니-백업-${dateKey()}.json`, { type: "application/json" });
  // 폰이면 공유 시트(파일에 저장 / 메일 등), 아니면 다운로드
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "머니 백업" });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.entries) || !Array.isArray(data.messages)) throw new Error("형식이 달라요");
      if (!confirm(`백업 파일의 기록 ${data.entries.length}건으로 바꿀까요?\n지금 있는 기록은 사라져요.`)) return;
      db = { ...empty(), ...data };
      save();
      location.reload();
    } catch {
      alert("백업 파일을 읽을 수 없어요. 머니에서 저장한 파일이 맞는지 확인해줘.");
    }
  };
  reader.readAsText(file);
}

export function installLocalApi() {
  greet();
  navigator.storage?.persist?.().catch(() => {}); // 브라우저가 기록을 함부로 지우지 않게 요청

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init.method || "GET").toUpperCase();
    let status = 200;
    let body;
    try {
      const r = route(method, url, init.body ? JSON.parse(init.body) : {});
      status = r.status || 200;
      body = r.body;
    } catch (e) {
      status = 500;
      body = { error: String(e.message || e) };
    }
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };

  document.getElementById("exportBtn")?.addEventListener("click", exportBackup);
  const input = document.getElementById("importInput");
  document.getElementById("importBtn")?.addEventListener("click", () => input.click());
  input?.addEventListener("change", () => {
    if (input.files[0]) importBackup(input.files[0]);
    input.value = "";
  });
}

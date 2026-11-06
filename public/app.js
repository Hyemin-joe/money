// 머니 – 화면 동작
// 로그인이 풀리면 로그인 화면으로 보냄
const _fetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const r = await _fetch(...args);
  if (r.status === 401) location.href = "/login.html";
  return r;
};

const $ = (s) => document.querySelector(s);
const thread = $("#thread");
const textInput = $("#text");
const sendBtn = $("#sendBtn");

const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
let lastId = 0;
let lastRendered = null; // 직전 말풍선 정보 (묶음/꼬리 처리용)
let aiEnabled = false;

/* ---------------- 대화 그리기 ---------------- */

function stampText(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 864e5);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const time = d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  let day;
  if (same(d, today)) day = "오늘";
  else if (same(d, yest)) day = "어제";
  else day = d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  return `<b>${day}</b> ${time}`;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function renderMessage(m) {
  const gapMs = lastRendered ? m.ts - lastRendered.ts : Infinity;
  if (gapMs > 60 * 60 * 1000) {
    thread.appendChild(el("div", "stamp", stampText(m.ts)));
    lastRendered = null;
  }
  const sameSender = lastRendered && lastRendered.role === m.role;
  // 같은 사람이 연달아 보내면 이전 말풍선의 꼬리를 뗀다
  if (sameSender) lastRendered.node.classList.remove("tail");

  const wrap = el("div", `msg ${m.role} tail${sameSender ? "" : " gap"}`);
  if (m.image) {
    const img = el("img", "photo");
    img.src = m.image;
    img.alt = "보낸 사진";
    img.addEventListener("load", scrollDown);
    wrap.appendChild(img);
  }
  if (m.text) wrap.appendChild(el("div", "bubble", esc(m.text)));

  // 기록된 항목 + 되돌리기
  for (const e of m.entries || []) {
    const meta = el("div", "meta");
    const label = el("span", "", `${esc(e.category)} · ${e.type === "income" ? "+" : ""}${won(e.amount)}`);
    const undo = el("button", "undo", "되돌리기");
    undo.onclick = async () => {
      undo.disabled = true;
      const r = await fetch(`/api/entries/${e.id}`, { method: "DELETE" });
      if (r.ok) {
        label.classList.add("gone");
        undo.replaceWith(el("span", "", "취소됨"));
      } else undo.disabled = false;
    };
    meta.append(label, undo);
    wrap.appendChild(meta);
  }

  if (m.askNotify) {
    const btn = el("button", "pill", "알림 켜기");
    bindNotifyButton(btn);
    wrap.appendChild(btn);
  }

  thread.appendChild(wrap);
  lastRendered = { role: m.role, ts: m.ts, node: wrap };
  lastId = Math.max(lastId, m.id || 0);
}

function scrollDown() {
  thread.scrollTop = thread.scrollHeight;
}

let typingNode = null;
function showTyping(on) {
  if (on && !typingNode) {
    typingNode = el("div", "msg bot tail gap");
    typingNode.appendChild(el("div", "bubble typing", "<i></i><i></i><i></i>"));
    thread.appendChild(typingNode);
    scrollDown();
  } else if (!on && typingNode) {
    typingNode.remove();
    typingNode = null;
  }
}

async function loadMessages() {
  const r = await fetch(`/api/messages${lastId ? `?after=${lastId}` : ""}`);
  const data = await r.json();
  aiEnabled = data.aiEnabled;
  if (!data.messages.length) return;
  data.messages.forEach(renderMessage);
  scrollDown();
}

/* ---------------- 보내기 ---------------- */

// 내 말풍선은 바로 보여주고, 머니의 답장만 서버에서 받아 붙인다
let inFlight = 0;
async function post(url, body, preview) {
  showTyping(false);
  renderMessage({ ...preview, role: "user", ts: Date.now(), id: 0 });
  const myNode = lastRendered.node;
  inFlight++;
  showTyping(true);
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "오류");
    if (--inFlight === 0) showTyping(false);
    const [mine, ...replies] = data.messages;
    lastId = Math.max(lastId, mine.id);
    if (typingNode) typingNode.remove(); // 답장을 '…' 위에 놓기 위해 잠시 뺐다가
    replies.forEach(renderMessage);
    if (typingNode) thread.appendChild(typingNode);
  } catch (e) {
    if (--inFlight === 0) showTyping(false);
    const offline = e instanceof TypeError; // 서버에 아예 연결이 안 됨
    myNode.appendChild(
      el("div", "status", offline ? "전송 실패 – 머니가 꺼져 있어요. '시작하기.command'를 실행해 줘" : "전송 실패 – 다시 보내줘"),
    );
  }
  scrollDown();
}

$("#composer").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = "";
  sendBtn.disabled = true;
  post("/api/chat", { text }, { text });
});

textInput.addEventListener("input", () => {
  sendBtn.disabled = !textInput.value.trim();
});

/* ---------------- 사진 ---------------- */

$("#photoBtn").onclick = () => $("#photoInput").click();

$("#photoInput").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  const dataUrl = await shrinkImage(file, 1600);
  const caption = textInput.value.trim();
  textInput.value = "";
  post("/api/photo", { dataUrl, caption }, { image: dataUrl, text: caption });
});

// 큰 사진은 줄여서 보낸다 (빠르고 저렴하게)
function shrinkImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------------- 알림 ---------------- */

const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enableNotifications() {
  if (!pushSupported) throw new Error("이 브라우저는 알림을 지원하지 않아요");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("알림이 허용되지 않았어요");
  const reg = await navigator.serviceWorker.ready;
  const { key } = await (await fetch("/api/push/key")).json();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
  await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
}

const notifyButtons = [];
function setNotifyButtonsOn() {
  notifyButtons.forEach((b) => {
    b.textContent = "켜짐 ✓";
    b.disabled = true;
  });
}
function bindNotifyButton(btn) {
  notifyButtons.push(btn);
  if (pushSupported && Notification.permission === "granted") {
    btn.textContent = "켜짐 ✓";
    btn.disabled = true;
  }
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await enableNotifications();
      setNotifyButtonsOn();
    } catch (e) {
      btn.disabled = false;
      alert(e.message + (Notification.permission === "denied" ? "\n\n주소창 왼쪽 자물쇠 아이콘 → 알림 → 허용 으로 바꿔줘." : ""));
    }
  };
}
bindNotifyButton($("#notifyBtn"));

$("#testPush").onclick = async () => {
  const r = await (await fetch("/api/push/test", { method: "POST" })).json();
  if (!r.count) alert("먼저 '밤 9시 알림'을 켜줘!");
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");

/* ---------------- 통계 ---------------- */

const sheet = $("#sheet");
let period = "month";
let offset = 0;

$("#openStats").onclick = () => {
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  loadStats();
};
$("#closeStats").onclick = () => {
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
};
document.querySelectorAll(".segmented button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".segmented button").forEach((x) => x.classList.toggle("on", x === b));
    period = b.dataset.period;
    offset = 0;
    loadStats();
  };
});
$("#prev").onclick = () => { offset--; loadStats(); };
$("#next").onclick = () => { if (offset < 0) { offset++; loadStats(); } };

// 카테고리마다 정해진 색 (차분한 톤)
const CAT_COLORS = { 식비: "#ff9f0a", 카페: "#a2845e", 교통: "#0a84ff", 쇼핑: "#bf5af2", 생활: "#30b0c7", 문화: "#ff375f", 의료: "#34c759", 기타: "#8e8e93" };
const catColor = (name) => CAT_COLORS[name] || "#8e8e93";

let lastStats = null;
let activeCat = null; // 눌러서 고른 카테고리
let statsKey = "";

async function loadStats() {
  const s = await (await fetch(`/api/stats?period=${period}&offset=${offset}`)).json();
  // 기간이 바뀌면 카테고리 선택은 풀어준다
  const key = `${period}:${offset}`;
  if (key !== statsKey) {
    activeCat = null;
    statsKey = key;
  }
  lastStats = s;
  renderStats();
}

function renderStats() {
  const s = lastStats;
  if (!s) return;
  if (activeCat && !s.categories.some((c) => c.name === activeCat)) activeCat = null;

  $("#periodLabel").textContent = s.label;
  $("#next").disabled = offset >= 0;
  $("#sumExpense").textContent = won(s.expense);
  $("#sumIncome").textContent = won(s.income);

  // 카테고리별: 한 줄 비율 막대 + 목록(비율, 금액)
  const total = s.expense || 1;
  $("#catStack").innerHTML = s.categories
    .map((c) => `<i style="flex:${c.amount};background:${catColor(c.name)};${activeCat && activeCat !== c.name ? "opacity:.25" : ""}"></i>`)
    .join("");
  $("#catList").innerHTML = s.categories.length
    ? s.categories
        .map((c) => {
          const pct = (c.amount / total) * 100;
          const pctText = pct < 1 ? "1% 미만" : `${Math.round(pct)}%`;
          return `<li class="row cat${activeCat === c.name ? " on" : ""}" data-cat="${esc(c.name)}" role="button" tabindex="0">
            <span class="dot" style="background:${catColor(c.name)}"></span>
            <span class="title" style="flex:1">${esc(c.name)}</span>
            <span class="pct">${pctText}</span>
            <span class="amt">${won(c.amount)}</span></li>`;
        })
        .join("")
    : `<li class="empty">아직 쓴 돈이 없어</li>`;
  $("#catHint").hidden = !s.categories.length;

  $("#placeList").innerHTML = s.places.length
    ? s.places.map((p) => `<li class="row"><span class="title">${esc(p.name)}</span><span class="amt">${won(p.amount)}</span></li>`).join("")
    : `<li class="empty">아직 기록이 없어</li>`;

  // 날짜별 내역 (카테고리를 골랐으면 그 카테고리 지출만)
  const entries = activeCat ? s.entries.filter((e) => e.type === "expense" && e.category === activeCat) : s.entries;
  $("#entryTitle").textContent = activeCat ? `${activeCat} 내역` : "전체 내역";
  const byDay = {};
  entries.forEach((e) => (byDay[e.date] ||= []).push(e));
  const days = Object.keys(byDay);
  $("#entryList").innerHTML = days.length
    ? days
        .map((d) => {
          const label = new Date(d + "T00:00").toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
          const rows = byDay[d]
            .map(
              (e) => `<li class="row"><div class="left"><div class="title">${esc(e.place)}</div><div class="sub">${esc(e.category)}</div></div>
              <span class="amt ${e.type === "income" ? "in" : ""}">${e.type === "income" ? "+" : "-"}${won(e.amount)}</span></li>`,
            )
            .join("");
          return `<div class="day">${label}</div><ul class="list">${rows}</ul>`;
        })
        .join("")
    : `<ul class="list"><li class="empty">이 기간엔 기록이 없어</li></ul>`;

  $("#aiState").textContent = aiEnabled ? "AI가 문장을 이해해요" : "";
}

// 카테고리를 누르면 그 내역만, 한 번 더 누르면 전체로
function pickCategory(ev) {
  const li = ev.target.closest("[data-cat]");
  if (!li) return;
  if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
  ev.preventDefault();
  activeCat = activeCat === li.dataset.cat ? null : li.dataset.cat;
  renderStats();
}
$("#catList").addEventListener("click", pickCategory);
$("#catList").addEventListener("keydown", pickCategory);

/* ---------------- 시작 ---------------- */

loadMessages();
// 밤 9시 메시지 등 새 말풍선을 주기적으로 확인
setInterval(() => { if (!typingNode) loadMessages(); }, 20000);

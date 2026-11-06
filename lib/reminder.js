// 매일 밤 9시 알림
import fs from "node:fs";
import webpush from "web-push";
import path from "node:path";
import db, { save, nextId, dateKey, DATA_DIR } from "./db.js";

const REMIND_HOUR = Number(process.env.REMIND_HOUR || 21);
const VAPID_FILE = path.join(DATA_DIR, "vapid.json");

// 알림용 열쇠(VAPID)는 처음 실행할 때 자동으로 만들어 저장합니다.
let vapid;
if (fs.existsSync(VAPID_FILE)) {
  vapid = JSON.parse(fs.readFileSync(VAPID_FILE, "utf8"));
} else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid, null, 2));
}
webpush.setVapidDetails("mailto:money-chat@localhost", vapid.publicKey, vapid.privateKey);

export const vapidPublicKey = vapid.publicKey;

export function reminderText() {
  const today = dateKey();
  const count = db.entries.filter((e) => e.date === today).length;
  return count === 0
    ? "오늘 하루 어땠어? 쓴 돈이나 들어온 돈 있으면 알려줘 💬"
    : `오늘 ${count}건 기록했어! 혹시 빠뜨린 거 없어? 💬`;
}

export async function sendPushToAll(body) {
  const payload = JSON.stringify({ title: "money friend", body });
  const alive = [];
  for (const sub of db.subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      alive.push(sub);
    } catch (err) {
      // 404/410 = 더 이상 쓰지 않는 구독 → 지움
      if (err.statusCode !== 404 && err.statusCode !== 410) alive.push(sub);
      else console.log("만료된 알림 구독을 정리했어요");
    }
  }
  db.subscriptions = alive;
  save();
}

function tick() {
  const now = new Date();
  const today = dateKey(now);
  if (now.getHours() < REMIND_HOUR || db.meta.lastReminderDate === today) return;
  // 컴퓨터가 꺼져 있다 늦게 켜져도 자정 전이면 한 번은 물어봅니다.
  db.meta.lastReminderDate = today;
  const text = reminderText();
  db.messages.push({ id: nextId(), role: "bot", text, ts: Date.now(), reminder: true });
  save();
  sendPushToAll(text).catch((e) => console.error("알림 전송 실패:", e.message));
  console.log(`[${now.toLocaleTimeString()}] 밤 ${REMIND_HOUR}시 알림을 보냈어요`);
}

export function startReminder() {
  tick();
  setInterval(tick, 30 * 1000);
}

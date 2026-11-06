// 데이터 저장소: data/db.json 파일 하나에 모든 기록을 저장합니다.
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const empty = () => ({
  messages: [], // 채팅 말풍선
  entries: [], // 지출/수익 기록
  subscriptions: [], // 알림 받을 브라우저 목록
  meta: { lastReminderDate: null, nextId: 1 },
});

let db = empty();
if (fs.existsSync(DB_FILE)) {
  try {
    db = { ...empty(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
  } catch {
    // 파일이 깨졌으면 백업해 두고 새로 시작
    fs.renameSync(DB_FILE, DB_FILE + ".broken-" + Date.now());
  }
}

export function save() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function nextId() {
  const id = db.meta.nextId++;
  return id;
}

export default db;

export { dateKey } from "../public/shared/statsCore.js";

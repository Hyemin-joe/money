// 서버용: 저장된 기록으로 주/월/년 합계 계산
import db from "./db.js";
import { computeStats } from "../public/shared/statsCore.js";

export const getStats = (period, offset) => computeStats(db.entries, period, offset);

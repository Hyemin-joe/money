// 간단한 질문에 기록으로 답하기: "나 오늘 얼마 썼어?", "이번 달 카페 얼마?", "제일 많이 쓴 곳은?"
// 서버(맥)와 폰 화면이 같이 씁니다. 숫자는 저장된 기록을 직접 계산해요.
import { dateKey } from "./statsCore.js";
import { categoryFromText } from "./localParser.js";

const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
const MONEY_WORD = /(얼마|썼|쓴|지출|소비|수입|벌었|번\s?돈|받았|들어온|내역|잔액|남았|합계|총액|돈|목록|리스트|많이)/;
const QUESTION_WORD = /(\?|얼마|몇|알려|보여|어디|뭐|많이|합계|총|내역|잔액|남았|목록|리스트)/;
const NO_SPEND = /(안\s?썼|안\s?씀|안\s?쓴|무지출|없었|없어)/;

const day = (d) => dateKey(d);

// 말에서 기간 찾기 (못 찾으면 null)
function resolvePeriod(t, now) {
  const Y = now.getFullYear();
  const M = now.getMonth();
  const D = now.getDate();
  const mondayShift = (now.getDay() + 6) % 7;
  const week = (offset) => {
    const s = new Date(Y, M, D - mondayShift + offset * 7);
    const e = new Date(Y, M, D - mondayShift + offset * 7 + 6);
    return { start: day(s), end: day(e) };
  };
  const month = (offset) => {
    const s = new Date(Y, M + offset, 1);
    const e = new Date(Y, M + offset + 1, 0);
    return { start: day(s), end: day(e) };
  };
  let m;
  if (/그제|그저께/.test(t)) return { start: day(new Date(Y, M, D - 2)), end: day(new Date(Y, M, D - 2)), label: "그저께" };
  if (/어제/.test(t)) return { start: day(new Date(Y, M, D - 1)), end: day(new Date(Y, M, D - 1)), label: "어제" };
  if (/(지난|저번)\s?주/.test(t)) return { ...week(-1), label: "지난주", multi: true };
  if (/(이번\s?주|금주)/.test(t)) return { ...week(0), label: "이번 주", multi: true };
  if (/(지난|저번)\s?달|전달/.test(t)) return { ...month(-1), label: "지난달", multi: true };
  if (/(이번\s?달|이달|금월)/.test(t)) return { ...month(0), label: "이번 달", multi: true };
  if (/(작년|지난해)/.test(t)) return { start: `${Y - 1}-01-01`, end: `${Y - 1}-12-31`, label: "작년", multi: true };
  if (/(올해|이번\s?년|금년)/.test(t)) return { start: `${Y}-01-01`, end: `${Y}-12-31`, label: "올해", multi: true };
  if ((m = t.match(/(\d{1,2})\s?월/))) {
    const mm = Number(m[1]);
    if (mm >= 1 && mm <= 12) {
      const yy = mm - 1 > M ? Y - 1 : Y;
      return { start: day(new Date(yy, mm - 1, 1)), end: day(new Date(yy, mm, 0)), label: `${mm}월`, multi: true };
    }
  }
  if ((m = t.match(/최근\s?(\d{1,3})\s?일/)) || (m = /일주일/.test(t) ? [0, 7] : null)) {
    const n = Number(m[1]);
    return { start: day(new Date(Y, M, D - (n - 1))), end: day(now), label: `최근 ${n}일`, multi: true };
  }
  if (/오늘/.test(t)) return { start: day(now), end: day(now), label: "오늘" };
  return null;
}

// 가게 이름처럼 쓰이지 않는 흔한 말 (이런 말은 가게가 아니라 카테고리로 봄)
const GENERIC = new Set(["점심", "저녁", "아침", "밥", "간식", "커피", "술", "맥주", "식비", "카페", "교통", "쇼핑", "생활", "문화", "의료", "기타"]);

// 질문에 나온 가게 이름 찾기
function findPlace(t, entries) {
  const seen = new Set();
  for (const e of entries) {
    for (const token of String(e.place).split(/\s+/)) {
      if (token.length < 2 || seen.has(token)) continue;
      seen.add(token);
      if (t.includes(token) && !GENERIC.has(token)) return token;
    }
  }
  return null;
}

const sum = (list) => list.reduce((a, e) => a + e.amount, 0);

function lines(list, multiDay, max = 5) {
  const sorted = [...list].sort((a, b) => b.amount - a.amount);
  const shown = (list.length <= max ? [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)) : sorted.slice(0, 3));
  const rows = shown.map((e) => `• ${multiDay ? `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8))} ` : ""}${e.place} ${won(e.amount)}`);
  if (list.length > shown.length) rows.push(`…외 ${list.length - shown.length}건`);
  return rows.join("\n");
}

function byCategory(list) {
  const map = {};
  for (const e of list) map[e.category] = (map[e.category] || 0) + e.amount;
  return Object.entries(map)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function answerQuery(text, entries, now = new Date()) {
  const t = text.trim();
  if (!MONEY_WORD.test(t) || !QUESTION_WORD.test(t)) return null;
  if (NO_SPEND.test(t) && !/\?|얼마/.test(t)) return null; // "오늘 안 썼어"는 질문이 아니라 기록

  const wantsNet = /(남았|남은|잔액|차액|순수익)/.test(t);
  const wantsIncome = !wantsNet && /(수입|벌었|번\s?돈|받았|들어온|입금|월급)/.test(t);
  const wantsTop = !wantsNet && !wantsIncome && /(제일|가장|젤|최고|어디에).*(많이|큰|비싼)/.test(t);

  // 가게 이름·카테고리 (기간과 상관없이 전체 기록에서 찾음)
  const allExpenses = entries.filter((e) => e.type === "expense");
  const place = wantsNet || wantsIncome || wantsTop ? null : findPlace(t, allExpenses);
  const cat = place || wantsNet || wantsIncome || wantsTop ? null : categoryFromText(t);

  // 기간: 말한 게 있으면 그대로, 없으면 → 합계는 "오늘", 카테고리·가게·남은 돈·최다 질문은 "이번 달"
  let p = resolvePeriod(t, now);
  if (!p) {
    const month = { start: day(new Date(now.getFullYear(), now.getMonth(), 1)), end: day(new Date(now.getFullYear(), now.getMonth() + 1, 0)), label: "이번 달", multi: true };
    if (/(총|전체|누적|지금까지)/.test(t)) p = { start: null, end: null, label: "지금까지", multi: true };
    else if (wantsNet || wantsTop || place || cat) p = month;
    else p = { start: day(now), end: day(now), label: "오늘" };
  }
  const inPeriod = entries.filter((e) => !p.start || (e.date >= p.start && e.date <= p.end));
  const expenses = inPeriod.filter((e) => e.type === "expense");
  const incomes = inPeriod.filter((e) => e.type === "income");

  // 남은 돈
  if (wantsNet) {
    const inc = sum(incomes);
    const exp = sum(expenses);
    const net = inc - exp;
    const tail = net >= 0 ? `남은 돈은 ${won(net)}이야 ✨` : `${won(-net)} 더 썼어 😮`;
    return `${p.label} 들어온 돈 ${won(inc)}, 쓴 돈 ${won(exp)}\n→ ${tail}`;
  }

  // 들어온 돈
  if (wantsIncome) {
    if (!incomes.length) return `${p.label} 들어온 돈은 아직 기록이 없어 🙂`;
    return `${p.label} 들어온 돈은 ${won(sum(incomes))}이야 💰\n${lines(incomes, p.multi)}`;
  }

  // 제일 많이 쓴 곳
  if (wantsTop) {
    if (!expenses.length) return `${p.label} 쓴 돈이 아직 없어 🙌`;
    if (/(곳|가게|어디서)/.test(t)) {
      const places = {};
      for (const e of expenses) places[e.place] = (places[e.place] || 0) + e.amount;
      const [name, amount] = Object.entries(places).sort((a, b) => b[1] - a[1])[0];
      return `${p.label} 가장 많이 쓴 곳은 ${name}(${won(amount)})이야 👀`;
    }
    const cats = byCategory(expenses);
    const total = sum(expenses);
    const pct = (a) => Math.round((a / total) * 100);
    const rest = cats.slice(1, 3).map((c) => `${c.name} ${won(c.amount)}(${pct(c.amount)}%)`).join(" · ");
    return `${p.label} 가장 많이 쓴 건 ${cats[0].name}, ${won(cats[0].amount)}(${pct(cats[0].amount)}%)이야 👀${rest ? `\n다음은 ${rest}` : ""}`;
  }

  // 쓴 돈 (카테고리·가게 필터)
  let list = expenses;
  let target = "";
  if (place) {
    list = expenses.filter((e) => String(e.place).includes(place));
    target = `'${place}'에 `;
  } else if (cat) {
    list = expenses.filter((e) => e.category === cat);
    target = `${cat}에 `;
  }

  if (!list.length) return `${p.label} ${target}쓴 돈은 아직 기록이 없어 🙌`;

  // 내역 보기
  if (/(내역|목록|리스트|뭐\s?(썼|샀))/.test(t)) {
    return `${p.label} ${target}쓴 내역이야 (${list.length}건, ${won(sum(list))})\n${lines(list, p.multi, 8)}`;
  }

  let reply = `${p.label} ${target}쓴 돈은 ${won(sum(list))}이야 💸 (${list.length}건)\n${lines(list, p.multi)}`;
  if (!place && !cat) {
    const cats = byCategory(list);
    if (cats.length > 1) reply += `\n\n${cats.slice(0, 3).map((c) => `${c.name} ${won(c.amount)}`).join(" · ")}`;
  }
  return reply;
}

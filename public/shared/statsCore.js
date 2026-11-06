// 주 / 월 / 년 합계 계산 (서버와 폰 화면이 같이 씁니다)

// 'YYYY-MM-DD' (이 기기의 시간대 기준)
export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function range(period, offset) {
  const now = new Date();
  let start, end, label;
  const f = (d) => `${d.getMonth() + 1}.${d.getDate()}`;
  if (period === "week") {
    const day = (now.getDay() + 6) % 7; // 월요일=0
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offset * 7);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    label = offset === 0 ? "이번 주" : offset === -1 ? "지난주" : `${f(start)} – ${f(end)}`;
  } else if (period === "year") {
    const y = now.getFullYear() + offset;
    start = new Date(y, 0, 1);
    end = new Date(y, 11, 31);
    label = `${y}년`;
  } else {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    label = `${start.getFullYear()}년 ${start.getMonth() + 1}월`;
  }
  return { start: dateKey(start), end: dateKey(end), label };
}

export function computeStats(allEntries, period = "month", offset = 0) {
  const { start, end, label } = range(period, offset);
  const entries = allEntries
    .filter((e) => e.date >= start && e.date <= end)
    .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));

  let expense = 0;
  let income = 0;
  const byCat = {};
  const byPlace = {};
  for (const e of entries) {
    if (e.type === "income") {
      income += e.amount;
    } else {
      expense += e.amount;
      byCat[e.category] = (byCat[e.category] || 0) + e.amount;
      byPlace[e.place] = (byPlace[e.place] || 0) + e.amount;
    }
  }
  const sortObj = (o) =>
    Object.entries(o)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

  return { period, offset, label, start, end, expense, income, categories: sortObj(byCat), places: sortObj(byPlace).slice(0, 5), entries };
}

// AI 없이도 동작하는 간단한 문장 해석기
// 예) "스타벅스 5800", "점심 김밥 4천원", "월급 300만원 들어옴", "오늘 안 썼어"

const INCOME_WORDS = ["월급", "급여", "용돈", "입금", "받았", "받음", "들어왔", "들어옴", "수입", "환급", "이자", "알바비", "보너스", "상여", "정산받", "팔았"];
const NONE_WORDS = ["안 썼", "안썼", "없어", "없었", "무지출", "안 씀", "안씀", "0원", "없음"];

const CATEGORY_RULES = [
  ["카페", ["스타벅스", "카페", "커피", "투썸", "이디야", "메가", "빽다방", "컴포즈", "라떼", "아메리카노"]],
  ["식비", ["점심", "저녁", "아침", "식당", "밥", "김밥", "치킨", "피자", "배달", "배민", "요기요", "쿠팡이츠", "맥도날드", "버거", "편의점", "떡볶이", "국밥", "라면", "마라탕", "술", "맥주"]],
  ["교통", ["택시", "버스", "지하철", "교통", "카카오T", "주유", "기름", "주차", "ktx", "KTX", "기차"]],
  ["쇼핑", ["쿠팡", "무신사", "올리브영", "다이소", "옷", "신발", "쇼핑", "마켓컬리", "컬리", "네이버페이"]],
  ["생활", ["마트", "이마트", "홈플러스", "관리비", "월세", "통신", "핸드폰", "전기", "가스", "세탁", "생필품"]],
  ["문화", ["영화", "넷플릭스", "유튜브", "공연", "전시", "책", "게임", "멜론", "스포티파이", "구독"]],
  ["의료", ["병원", "약국", "약", "치과", "한의원"]],
];

function guessCategory(text, type) {
  if (type === "income") {
    if (/월급|급여|보너스|상여/.test(text)) return "월급";
    if (/용돈/.test(text)) return "용돈";
    return "기타수입";
  }
  for (const [cat, words] of CATEGORY_RULES) {
    if (words.some((w) => text.includes(w))) return cat;
  }
  return "기타";
}

// "3만5천원", "35,000원", "4천", "300만원", "5800" → 숫자
const AMOUNT_RE = /((?:\d[\d,]*(?:\.\d+)?\s*[만천백]\s*)+(?:\d[\d,]*)?|\d[\d,]*)\s*원?/g;
const UNIT = { 만: 10000, 천: 1000, 백: 100 };

export function parseAmount(text) {
  let best = null;
  for (const m of text.matchAll(AMOUNT_RE)) {
    let v = 0;
    for (const part of m[1].matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([만천백])?/g)) {
      v += parseFloat(part[1].replace(/,/g, "")) * (UNIT[part[2]] || 1);
    }
    v = Math.round(v);
    if (v > 0 && (best === null || v > best.value)) best = { value: v, raw: m[0] };
  }
  return best;
}

export function localParse(text) {
  const clean = text.trim();
  const amount = parseAmount(clean);

  if (!amount) {
    if (NONE_WORDS.some((w) => clean.includes(w))) return { kind: "none_today", items: [] };
    return { kind: "chat", items: [] };
  }

  const type = INCOME_WORDS.some((w) => clean.includes(w)) ? "income" : "expense";
  // 금액 부분과 군더더기 말을 빼면 장소/내용만 남음
  let place = clean
    .replace(amount.raw, " ")
    .replace(/(에서|에|으로|로)\s/g, " ")
    .replace(/(썼어|썼음|씀|결제|지출|들어옴|들어왔어|받았어|받음|입금|했어|오늘|어제)/g, " ")
    .replace(/[~!?.ㅋㅎ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!place) place = type === "income" ? "수입" : "지출";

  return {
    kind: "record",
    items: [{ type, place, amount: amount.value, category: guessCategory(clean, type), memo: "", date: null }],
  };
}

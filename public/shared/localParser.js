// AI 없이도 동작하는 간단한 문장 해석기
// 예) "스타벅스 5800", "점심 김밥 4천원", "월급 300만원 들어옴", "오늘 안 썼어"

const INCOME_WORDS = ["월급", "급여", "용돈", "입금", "받았", "받음", "들어왔", "들어옴", "수입", "환급", "이자", "알바비", "보너스", "상여", "정산받", "팔았"];
const NONE_WORDS = ["안 썼", "안썼", "없어", "없었", "무지출", "안 씀", "안씀", "0원", "없음"];

const CATEGORY_RULES = [
  ["카페", ["스타벅스", "카페", "커피", "투썸", "이디야", "메가", "빽다방", "컴포즈", "라떼", "아메리카노"]],
  ["식비", ["점심", "저녁", "아침", "식당", "밥", "김밥", "치킨", "피자", "배달", "배민", "요기요", "쿠팡이츠", "맥도날드", "버거", "편의점", "떡볶이", "국밥", "라면", "마라탕", "술", "맥주", "삼겹살", "고기", "빵", "과자", "간식", "분식", "회식", "도시락"]],
  ["교통", ["택시", "버스", "지하철", "교통", "카카오T", "주유", "기름", "주차", "ktx", "KTX", "기차"]],
  ["쇼핑", ["쿠팡", "무신사", "올리브영", "다이소", "옷", "신발", "쇼핑", "마켓컬리", "컬리", "네이버페이"]],
  ["생활", ["마트", "이마트", "홈플러스", "관리비", "월세", "통신", "핸드폰", "전기", "가스", "세탁", "생필품"]],
  ["문화", ["영화", "넷플릭스", "유튜브", "공연", "전시", "책", "게임", "멜론", "스포티파이", "구독"]],
  ["의료", ["병원", "약국", "약", "치과", "한의원"]],
];

// 글에서 카테고리만 알아냄 (없으면 null). 예: "커피" → 카페, "식비" → 식비
export function categoryFromText(text) {
  for (const [cat, words] of CATEGORY_RULES) {
    if (text.includes(cat) || words.some((w) => text.includes(w))) return cat;
  }
  return null;
}

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

// 금액 읽기: "5800", "3,200원", "4천원", "1만2천원", "2.5만", 그리고 한글 "만원", "오천원", "삼만오천원"
const UNIT = { 만: 10000, 천: 1000, 백: 100 };
const KOR_DIGIT = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const SMALL_UNIT = { 십: 10, 백: 100, 천: 1000 };
const BIG_UNIT = { 만: 1e4, 억: 1e8 };

// (1) 숫자가 들어간 금액: 단위 한글 허용, '원'은 없어도 됨
const AMOUNT_RE = /((?:\d[\d,]*(?:\.\d+)?\s*[만천백]\s*)+(?:\d[\d,]*)?|\d[\d,]*)\s*원?/g;
// (2) 한글 숫자가 들어간 금액: "만원", "오천원", "삼만오천원" – 헷갈리는 말(예: 이마트, 백화점, 만나서)을 피하려고 '원'으로 끝날 때만 인정
// 띄어쓰기는 "삼만 오천원", "삼 만원"처럼 단위(만·천·백·십·억) 옆에서만 허용 → "올리브영 이만원", "GS25 이천원"의 가게 이름을 금액으로 먹지 않게
const NUM = String.raw`(?:\d[\d,]*(?:\.\d+)?|[일이삼사오육칠팔구]|[십백천만억]\s?)`;
const KOREAN_RE = new RegExp(String.raw`${NUM}(?:(?:\s(?=[십백천만억]))?${NUM})*\s*원`, "g");

// "삼만오천" 같은 한글/숫자 섞인 글자를 숫자로 바꿈
function koreanToNumber(str) {
  let total = 0; // 만/억 단위로 끝난 덩어리
  let section = 0; // 만 안쪽(천·백·십) 합계
  let num = null; // 방금 읽은 숫자
  let prevWasKorDigit = false;
  for (const t of str.matchAll(/\d[\d,]*(?:\.\d+)?|[일이삼사오육칠팔구십백천만억]/g)) {
    const tok = t[0];
    if (/^\d/.test(tok)) {
      num = parseFloat(tok.replace(/,/g, ""));
      prevWasKorDigit = false;
    } else if (tok in KOR_DIGIT) {
      num = prevWasKorDigit && num !== null ? num * 10 + KOR_DIGIT[tok] : KOR_DIGIT[tok];
      prevWasKorDigit = true;
    } else if (tok in SMALL_UNIT) {
      section += (num ?? 1) * SMALL_UNIT[tok];
      num = null;
      prevWasKorDigit = false;
    } else {
      // 만, 억
      total += ((section + (num ?? 0)) || 1) * BIG_UNIT[tok];
      section = 0;
      num = null;
      prevWasKorDigit = false;
    }
  }
  return Math.round(total + section + (num ?? 0));
}

export function parseAmount(text) {
  const found = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    let v = 0;
    for (const part of m[1].matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([만천백])?/g)) {
      v += parseFloat(part[1].replace(/,/g, "")) * (UNIT[part[2]] || 1);
    }
    found.push({ value: Math.round(v), raw: m[0] });
  }
  for (const m of text.matchAll(KOREAN_RE)) {
    found.push({ value: koreanToNumber(m[0]), raw: m[0] });
  }
  // 여러 개 찾았으면(예: "사원 이천원" 의 "사원") 가장 큰 금액을 고름
  let best = null;
  for (const f of found) if (f.value > 0 && (!best || f.value > best.value)) best = f;
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

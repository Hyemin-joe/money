// AI 연결: 문장 이해 + 영수증 사진 읽기
// .env 에 아래 중 하나가 있으면 켜집니다. 둘 다 있으면 구글(무료)을 먼저 씁니다.
//   GEMINI_API_KEY     → 구글 AI 스튜디오 (무료 등급 있음)
//   ANTHROPIC_API_KEY  → Claude (유료)
// 없으면 간단 해석기만 사용합니다.
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const GEMINI_KEY = process.env.GEMINI_API_KEY?.trim();
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY?.trim();

export const aiProvider = GEMINI_KEY ? "gemini" : CLAUDE_KEY ? "claude" : null;
export const aiEnabled = aiProvider !== null;

const gemini = aiProvider === "gemini" ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;
const claude = aiProvider === "claude" ? new Anthropic({ apiKey: CLAUDE_KEY }) : null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const ItemSchema = z.object({
  type: z.enum(["expense", "income"]),
  place: z.string().describe("어디서/무엇 (예: 스타벅스, 점심 김밥, 월급)"),
  amount: z.number().describe("원 단위 정수"),
  category: z.enum(["식비", "카페", "교통", "쇼핑", "생활", "문화", "의료", "기타", "월급", "용돈", "기타수입"]),
  memo: z.string(),
  date: z.string().describe("YYYY-MM-DD. 날짜 언급이 없으면 빈 문자열"),
});

const ResultSchema = z.object({
  kind: z.enum(["record", "none_today", "chat"]).describe(
    "record=지출/수익 기록, none_today=오늘 쓴 돈/들어온 돈 없음, chat=그 외 대화",
  ),
  items: z.array(ItemSchema),
  reply: z.string().describe("친구처럼 짧고 다정한 반말 답장 1~2문장. 이모지 1개 정도."),
});

const SYSTEM = `너는 '머니'라는 이름의 다정한 가계부 친구야. 사용자가 채팅으로 보낸 지출/수익을 정리해.
- 한 메시지에 여러 건이 있으면 items 에 모두 넣어.
- 금액은 원 단위 정수로 ("4천5백" → 4500, "3만" → 30000).
- 금액을 알 수 없으면 기록하지 말고 kind=chat 으로, reply 에서 얼마였는지 물어봐.
- 영수증 사진이면 가게 이름과 '최종 결제 금액'만 1건으로 기록해 (품목별로 나누지 마).
- 답장은 잔소리 없이 가볍게. 금액은 3,000원 처럼 콤마를 붙여.`;

// ---------- 구글 Gemini ----------
const GEMINI_SCHEMA = z.toJSONSchema(ResultSchema);

async function askGemini(text, image, today) {
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.mediaType, data: image.base64 } });
  parts.push({ text });
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: `${SYSTEM}\n오늘 날짜: ${today}`,
      responseMimeType: "application/json",
      responseJsonSchema: GEMINI_SCHEMA,
    },
  });
  return ResultSchema.parse(JSON.parse(response.text));
}

// ---------- Claude ----------
async function askClaude(text, image, today) {
  const content = image
    ? [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } }, { type: "text", text }]
    : text;
  const response = await claude.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(ResultSchema) },
    system: `${SYSTEM}\n오늘 날짜: ${today}`,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error("AI 응답을 해석하지 못했어요");
  }
  return response.parsed_output;
}

function ask(text, image, today) {
  return aiProvider === "gemini" ? askGemini(text, image, today) : askClaude(text, image, today);
}

export function aiParseText(text, today) {
  return ask(text, null, today);
}

export function aiParseImage(base64, mediaType, caption, today) {
  return ask(caption || "이 결제 내역(영수증/캡처)을 기록해 줘.", { base64, mediaType }, today);
}

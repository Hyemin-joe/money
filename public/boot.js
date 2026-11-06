// 시작 스위치: 서버가 있으면 서버와 대화하고, 없으면(무료 호스팅) 폰 안에 저장합니다.
let mode = "local";
try {
  const r = await fetch("/api/ping", { cache: "no-store" });
  if (r.ok && (await r.json()).mode === "server") mode = "server";
} catch {}

document.documentElement.dataset.mode = mode;
if (mode === "local") {
  const { installLocalApi } = await import("/local-api.js");
  installLocalApi();
}

const s = document.createElement("script");
s.src = "/app.js";
document.body.appendChild(s);

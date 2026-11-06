// 무료 호스팅에 올릴 폴더(web-dist)를 만듭니다. 실행: npm run build:web
import fs from "node:fs";

fs.rmSync("web-dist", { recursive: true, force: true });
fs.cpSync("public", "web-dist", {
  recursive: true,
  filter: (src) => !src.endsWith("login.html"), // 서버용 로그인 화면은 제외
});
console.log("✅ web-dist 폴더가 만들어졌어요. 이 폴더를 통째로 올리면 돼요.");

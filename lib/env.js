// .env 파일(비밀 설정)을 읽어옵니다. 파일이 없어도 괜찮아요.
import fs from "node:fs";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
// 인터넷 서버는 보통 세계 표준시라서, 밤 9시 알림이 한국 시간에 맞게 시간대를 고정합니다.
process.env.TZ ||= "Asia/Seoul";

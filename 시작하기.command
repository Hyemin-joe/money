#!/bin/bash
# 이 파일을 더블클릭하면 머니가 켜지고 브라우저가 열려요.
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "처음 실행이라 필요한 부품을 설치하고 있어요..."
  npm install
fi
(sleep 2 && open "http://localhost:3000") &
npm start

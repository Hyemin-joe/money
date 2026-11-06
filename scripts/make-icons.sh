#!/bin/bash
# 홈 화면 아이콘 이미지를 만듭니다. 실행: bash scripts/make-icons.sh  (맥에서만 동작)
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
qlmanage -t -s 1024 -o "$tmp" scripts/icon/icon-full.svg >/dev/null 2>&1
src="$tmp/icon-full.svg.png"
[ -f "$src" ] || { echo "이미지 변환에 실패했어요"; exit 1; }
for spec in "apple-touch-icon.png:180" "icon-192.png:192" "icon-512.png:512"; do
  name=${spec%%:*}; size=${spec##*:}
  sips -z "$size" "$size" "$src" --out "public/$name" >/dev/null
  # 아이폰은 투명한 부분을 검게 칠하므로 투명 정보를 없앰 (jpg를 거쳐 다시 png로)
  sips -s format jpeg -s formatOptions 100 "public/$name" --out "$tmp/flat.jpg" >/dev/null
  sips -s format png "$tmp/flat.jpg" --out "public/$name" >/dev/null
done
cp public/icon-512.png public/icon-maskable-512.png
echo "✅ 아이콘 이미지를 만들었어요"

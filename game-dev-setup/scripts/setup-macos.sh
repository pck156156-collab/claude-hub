#!/usr/bin/env bash
# 게임 개발 도구 설치 스크립트 (macOS, Homebrew 사용)
# 실행: bash setup-macos.sh        (전체)
#       bash setup-macos.sh 1      (1단계만)

STEP="${1:-0}"   # 0 = 전체, 1~4 = 해당 단계만
FAILED=()

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew가 없습니다. https://brew.sh 의 설치 명령을 먼저 실행하세요."
  exit 1
fi

install_cask() {
  local cask="$1" name="$2" url="$3"
  echo
  echo ">> $name 설치 중..."
  if ! brew install --cask "$cask"; then
    echo "   $name 자동 설치 실패 (이미 설치됐을 수도 있음). 수동 설치: $url"
    FAILED+=("$name -> $url")
  fi
}

run_step() { [ "$STEP" = "0" ] || [ "$STEP" = "$1" ]; }

if run_step 1; then
  echo; echo "=== 1단계: 첫 2D 게임 (Godot) ==="
  install_cask godot "Godot" "https://godotengine.org/download"
fi

if run_step 2; then
  echo; echo "=== 2단계: 3D 입문 (Blender) ==="
  install_cask blender "Blender" "https://www.blender.org/download/"
fi

if run_step 3; then
  echo; echo "=== 3단계: 직접 제작 (Krita, LibreSprite, Tiled) ==="
  install_cask krita "Krita" "https://krita.org/en/download/"
  install_cask libresprite "LibreSprite" "https://libresprite.github.io/"
  install_cask tiled "Tiled" "https://www.mapeditor.org/"
fi

# 4단계: AI 활용은 설치 없음 (Claude에 연결된 Higgsfield / Adobe 사용)

ROOT="$HOME/GameDev"
mkdir -p "$ROOT/projects" "$ROOT/assets/kenney" "$ROOT/assets/quaternius" \
         "$ROOT/assets/mixamo" "$ROOT/assets/my-art" "$ROOT/assets/audio"
echo; echo "작업 폴더 준비됨: $ROOT"

if [ ${#FAILED[@]} -gt 0 ]; then
  echo; echo "수동 설치가 필요한 항목:"
  for f in "${FAILED[@]}"; do echo "  - $f"; done
fi
echo; echo "다음: game-dev-setup/README.md 의 체크리스트를 따라가세요."

# claude-hub — Claude가 직접 만드는 게임 작업장

사용자는 한국어로 요청하고, Claude가 이 저장소 안에서 게임과 에셋을 직접 만든다. 답변은 한국어로.

## 툴체인 (SessionStart hook이 자동 설치: `.claude/hooks/session-start.sh`)

| 용도 | 도구 | 사용법 |
|---|---|---|
| 2D 게임 | Phaser 4 | `templates/phaser-2d` 복사해서 시작 |
| 3D 게임 | Three.js | `templates/three-3d` 복사해서 시작 (.glb는 `GLTFLoader`) |
| 3D 모델 → 2D 스프라이트 | Blender (headless) | `blender -b -P tools/blender/render_sprites.py -- --model x.glb --out assets/generated/name --angles 8 --size 128` |
| 3D 모델 제작 | Blender Python | `blender -b --python-expr ...` 또는 스크립트로 메시 생성 후 `.glb` 내보내기 |
| 벡터/UI 아트 | Inkscape CLI | SVG 작성 → `inkscape x.svg -o x.png -w 256` |
| 이미지 가공 | ImageMagick, Pillow | 스프라이트 시트: `montage a_*.png -tile 8x1 -geometry +0+0 -background none sheet.png` |
| AI 컨셉 아트/음향 | Higgsfield MCP | 무료 플랜, 크레딧 적음 → `get_cost:true`로 비용 먼저 확인하고 사용자에게 물어볼 것 |
| 배경 제거/벡터화 | Adobe for creativity MCP | `adobe_mandatory_init` 먼저 호출 |

## 작업 흐름

1. 새 게임: `cp -r templates/phaser-2d games/<이름>` (또는 three-3d). 에셋 import 경로 확인.
2. 에셋: 코드로 그린 임시 도형 → Blender 렌더 / SVG / AI 생성 이미지로 교체. 결과물은 `assets/generated/<이름>/`.
3. 검증: `node tools/screenshot.mjs games/<이름> out.png` → 콘솔 에러 있으면 exit 1. 스크린샷을 직접 보고 확인.
4. 공유: `npx vite build` → `dist/games/<이름>/index.html` + `dist/assets/*` 를 Artifact로 게시해서 사용자가 브라우저에서 바로 플레이.

## 네트워크 제약

- 가능: Ubuntu apt, npm, PyPI
- 차단: github.com 릴리스(→ Godot 다운로드 불가), kenney.nl 등 에셋 사이트 → 에셋은 직접 생성하거나 사용자에게 도메인 허용 요청

## 게임

- `games/iron-raid/` — 메탈슬러그 레퍼런스 런앤건, 스테이지 1 데모. 그래픽·사운드 모두 코드로 생성(`src/art/`, `src/sfx.js`).
  - 스테이지 배치: `src/level.js`
  - 외부 에셋 규격: `games/iron-raid/docs/ASSET_SPEC.md`, 교체는 `content/manifest.json`
  - 자동 플레이 테스트: `node games/iron-raid/tools/playtest.mjs <출력폴더> [--god] [--warp 3050] [--seconds 200]`
  - 게시용 빌드: `npm run build:iron-raid` → `dist/iron-raid/iron-raid.html` + `assets/*.js`를 Artifact로 게시

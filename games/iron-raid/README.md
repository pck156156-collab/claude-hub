# IRON RAID — Stage 1 Demo

메탈슬러그를 레퍼런스로 한 2D 런앤건 게임의 스테이지 1 데모. Phaser 4 + Vite, 브라우저에서 실행된다.
현재 그래픽·사운드는 전부 코드로 만든 임시 에셋이며, 외부 에셋은 `content/`에 넣어 교체한다 → [docs/ASSET_SPEC.md](docs/ASSET_SPEC.md).

## 실행

필요: Node.js 20 이상 (개발 환경은 22), npm.

```bash
# 저장소 루트에서
npm install
npx vite                      # 개발 서버
# 브라우저: http://localhost:5173/games/iron-raid/        (타이틀부터)
#           http://localhost:5173/games/iron-raid/?play   (바로 게임 시작)
```

조작: ←→ 이동, ↑ 위 조준, ↓ 앉기(공중에서는 아래 조준), Z 발사(붙으면 칼), X 점프, C 폭탄(탱크 안에서는 포), ↓+X 지붕에서 내려오기·탱크에서 내리기, M 소리 켜기/끄기. WASD / J K L도 된다. 터치 기기에서는 화면 버튼이 나온다.

## 빌드·검사

```bash
npm run build:iron-raid        # dist/iron-raid/ (index.html, iron-raid.html, assets/, content/)
npm run iron-raid:check        # content/manifest.json 규격 검사
npm run iron-raid:reference    # 임시 에셋을 content-reference/ 와 spec/ 로 다시 추출
npm run iron-raid:playtest -- out --god --seconds 200   # 자동 플레이(스크린샷 + 오류 검사)
```

- 빌드 결과는 정적 파일이라 아무 웹 서버로 열면 된다 (`npx vite preview --outDir dist/iron-raid` 또는 `python3 -m http.server -d dist/iron-raid`). `file://`로 직접 열면 content 로딩이 막힌다.
- 자동 플레이 테스트는 Chromium이 필요하다. 기본 경로는 `/opt/pw-browsers/chromium`, 다른 곳이면 `CHROMIUM_PATH=/path/to/chrome`. 옵션: `--god` 무적, `--warp 3050` 보스 앞으로 이동, `--seconds N`.

## 폴더 구조

```
games/iron-raid/
├── index.html              개발용 페이지
├── README.md               이 문서
├── docs/ASSET_SPEC.md      외부 에셋 규격 (폴더·파일명·프레임·기준점·애니메이션·오디오)
├── content/                외부 에셋 넣는 곳 + manifest.json (지금은 비어 있음)
├── content-reference/      현재 임시 에셋 48종 (PNG + 아틀라스 JSON) — 새 에셋의 템플릿
├── spec/                   textures.json, animations.json (코드가 쓰는 규격, 자동 추출)
├── tools/                  build-publish / check-content / export-reference / playtest
└── src/
    ├── main.js             Phaser 설정 (384×216, pixelArt, 중력 700)
    ├── level.js            스테이지 배치 (적, 포로, 발판, 이벤트)
    ├── palette.js, font.js, gfx.js, sfx.js, touch.js
    ├── art/                임시 그래픽 생성 (humans, vehicles, world)
    ├── objects/            Player, Soldier, Pow, Tank, Vehicles(APC·헬기), Boss
    └── scenes/             Boot(에셋 로딩), Title, Game, Result
```

## 알려진 사항

- 수정 예정 목록(이동 속도 상향 등)은 기획서의 "데모 수정 목록" 탭에서 관리 중이며 아직 반영하지 않았다.
- `assets/generated/ray/`와 `tools/blender/chibi_ray.py`, `tools/pixelize.py`는 Blender → 도트 변환 스타일 시험 결과물로, 게임에는 쓰이지 않는다 (채택하지 않음).

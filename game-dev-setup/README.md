# 무료 게임 개발 환경 세팅 (2D + 3D)

단계 순서대로 따라가면 됩니다. 전부 무료입니다.

## 0. 설치 스크립트 실행 (한 번에)

| OS | 명령 |
|---|---|
| Windows | `powershell -ExecutionPolicy Bypass -File game-dev-setup\scripts\setup-windows.ps1` |
| macOS | `bash game-dev-setup/scripts/setup-macos.sh` |

- 특정 단계만 설치: Windows `-Step 1`, macOS 뒤에 `1` 붙이기
- 스크립트가 홈 폴더에 작업 폴더도 만들어 줍니다.

```
~/GameDev/
├── projects/          # Godot 프로젝트들
└── assets/
    ├── kenney/        # Kenney 에셋 (CC0)
    ├── quaternius/    # 3D 모델 (CC0)
    ├── mixamo/        # 3D 애니메이션
    ├── my-art/        # 직접 만든 그림/모델
    └── audio/         # 효과음, 음악
```

---

## 1단계: 첫 2D 게임 — Godot + Kenney

**설치**
- [ ] **Godot 4** (Standard 버전. C#을 쓸 게 아니면 .NET 버전은 필요 없음) — https://godotengine.org/download

**에셋 받기** → `~/GameDev/assets/kenney/`
- [ ] Kenney 에셋 — https://kenney.nl/assets
  - 처음엔 이 정도면 충분: *Pixel Platformer*, *Tiny Dungeon*, *UI Pack*, *Interface Sounds*
  - 전부 CC0 → 상업용 OK, 출처 표기 안 해도 됨

**웹 도구 (설치 없음, 북마크만)**
- [ ] 효과음: jsfxr — https://sfxr.me
- [ ] 음악: BeepBox — https://www.beepbox.co

**확인**
- [ ] Godot 실행 → 새 프로젝트를 `~/GameDev/projects/first-game` 에 만들기 (Renderer: *Compatibility* 가 가장 가볍고 호환성 좋음)
- [ ] Kenney 스프라이트 하나를 FileSystem 패널에 끌어다 놓고 씬에 배치해 보기

---

## 2단계: 3D 입문 — Blender + 무료 3D 에셋 + Mixamo

**설치**
- [ ] **Blender** — https://www.blender.org/download/

**에셋/계정**
- [ ] Quaternius 3D 모델 (CC0) — https://quaternius.com → `~/GameDev/assets/quaternius/`
- [ ] Kenney 3D 에셋 (같은 사이트에서 3D 필터)
- [ ] Poly Haven 텍스처·HDRI (CC0) — https://polyhaven.com
- [ ] Mixamo — https://www.mixamo.com (Adobe 무료 계정으로 로그인)

**확인**
- [ ] Mixamo에서 캐릭터 + 애니메이션 하나 받기 (FBX) → Blender에서 열기 → **glTF(.glb)** 로 내보내기
- [ ] 그 `.glb` 를 Godot 3D 씬에 넣어서 보이는지 확인 (Godot는 .glb를 제일 잘 읽음)

---

## 3단계: 직접 만들기 — Krita / LibreSprite / Tiled

**설치**
- [ ] **Krita** (일러스트, 배경, UI) — https://krita.org
- [ ] **LibreSprite** (픽셀아트, 스프라이트 애니메이션) — https://libresprite.github.io
- [ ] **Tiled** (타일맵; Godot 내장 TileMap으로 충분하면 생략 가능) — https://www.mapeditor.org

**웹 대안 (설치 없이)**
- 포토샵 대체: Photopea — https://www.photopea.com
- 픽셀아트: Piskel — https://www.piskelapp.com

**확인**
- [ ] Kenney 캐릭터 하나를 Krita/LibreSprite로 색만 바꿔서 `my-art/` 에 저장 → 게임에서 교체해 보기

---

## 4단계: AI 활용 — Higgsfield + Adobe (Claude에 연결됨)

설치 없음. Claude 세션에서 바로 씁니다.

- **Higgsfield** (현재 무료 플랜, 크레딧 적음): 키 아트, 캐릭터 컨셉, 트레일러 영상처럼 **중요한 것만** 사용
- **Adobe for creativity**: 배경 제거, 벡터 변환, 보정 → AI 이미지를 스프라이트로 다듬을 때 사용
- 흐름: 컨셉 이미지 생성 → 배경 제거 → Krita/LibreSprite로 게임 해상도에 맞게 정리 → Godot에 넣기

Claude에게 이렇게 요청하면 됩니다:
> "2D 판타지 플랫포머 주인공 컨셉 아트 만들어줘. 먼저 비용부터 알려줘"

---

## 라이선스 메모

- **CC0** (Kenney, Quaternius, Poly Haven): 마음대로 사용 가능
- **OpenGameArt / itch.io / Freesound**: 에셋마다 다름 → 받을 때 라이선스를 `assets/` 폴더에 같이 저장해 두기
- **Mixamo**: 게임에 포함해서 쓰는 건 무료지만, 에셋 자체를 재배포하는 건 안 됨

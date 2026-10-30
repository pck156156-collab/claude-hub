# Hub Engine — 웹 기반 2D 게임 엔진 & 에디터

코드 없이 레벨을 그리고, 컴포넌트를 붙이고, 바로 실행해 보고, 단일 HTML 게임 파일로 내보낼 수 있는 **게임 개발 엔진 프로그램**입니다.
외부 의존성 없이 ES 모듈 + HTML5 Canvas로만 만들어져 있습니다.

## 실행

```bash
npm start            # = python3 -m http.server 8000
```

- **에디터**: <http://localhost:8000/editor/>
- 코드로 직접 만든 예제 게임: <http://localhost:8000/examples/platformer/>

(ES 모듈은 `file://`로 열면 동작하지 않으니 로컬 서버를 사용하세요. 단, *내보낸 게임 파일*은 더블클릭만으로 실행됩니다.)

```bash
npm test             # 단위 테스트 (Node 18+)
```

## 🧒 쉬운 모드 (어린이용, 기본 화면)

처음 열면 어린이도 쓸 수 있는 **쉬운 모드**로 시작합니다. 오른쪽 위 **🧑‍💻 전문가** 버튼으로 전문가 모드와 오갈 수 있어요.

1. 왼쪽 **"무엇을 그릴까요?"** 에서 블록을 고르고 화면에 쓱쓱 그려요. (🧱 땅, 😊 주인공, ⭐ 별, 🔺 가시, 👾 괴물, 🍄 점프대, 🚩 깃발, 움직이는 발판)
2. **✋ 옮기기** 로 그린 것을 누르면 오른쪽 **🎨 꾸미기** 에서 색깔·크기·빠르기·점프 높이를 바꿀 수 있어요.
3. 초록색 **▶️ 놀이하기** 를 눌러 바로 놀아 봐요.
4. 다 만들면 **🎁 게임 파일** 로 친구에게 보낼 수 있는 게임 파일이 만들어져요.

- 아래쪽 🦉 도우미가 지금 무엇을 하면 되는지 단계별로 알려 줘요.
- 실수해도 **↩️ 되돌리기** 로 돌아갈 수 있고, 만든 게임은 자동으로 저장돼요.
- 주인공은 하나만 놓을 수 있고, 주인공 없이 놀이하기를 누르면 친절하게 알려 줘요.
- **태블릿/휴대폰**: 손가락으로 그리고, 게임 화면 아래 ◀ ▶ 점프 버튼으로 놀 수 있어요.

## 에디터 기능 (전문가 모드)

| 영역 | 기능 |
| --- | --- |
| 씬 뷰 | 격자, 휠 확대/축소, 우클릭·휠클릭·Space+드래그로 화면 이동, 게임 화면 영역 미리보기 |
| 도구 | **선택**(V): 클릭 선택·드래그 이동·오른쪽 아래 핸들로 크기 조절 / **칠하기**(B): 프리팹 브러시로 타일 그리기 / **지우기**(E) |
| 프리팹 | 땅, 주인공, 별, 가시, 괴물, 점프대, 깃발, 움직이는 발판(스크립트), 빈 오브젝트 — 클릭하면 브러시, 더블클릭하면 화면 중앙에 배치 |
| 계층 구조 | 씬의 오브젝트 목록, 클릭 선택 / 더블클릭으로 카메라 이동 / 삭제 |
| 인스펙터 | 이름·위치·크기·색·모양·Z순서·태그 편집, **컴포넌트 추가/제거 및 속성 편집**, 선택이 없으면 씬/프로젝트 설정 |
| 씬 | 여러 씬(레벨) 추가·복제·삭제, 시작 씬 지정, 깃발로 다음 씬 이동 |
| 실행 | ▶ 실행(F5)으로 편집 중인 씬을 즉시 플레이, Esc로 정지. 스크립트 오류는 콘솔에 표시 |
| 파일 | 자동 저장(브라우저), 프로젝트 `.json` 저장/열기, **게임 내보내기**(엔진 포함 단일 `.html`) |
| 편집 | 실행 취소/다시 실행(Ctrl+Z / Ctrl+Y), 복제(Ctrl+D), 삭제(Delete), 방향키로 한 칸 이동(Shift: 1px) |

### 컴포넌트

| 컴포넌트 | 설명 |
| --- | --- |
| 고체 (Solid) | 다른 물체가 통과하지 못하는 벽/바닥 |
| 물리 바디 (Body) | 중력, 속도, 고체와의 충돌 |
| 플레이어 조작 | 이동/점프 (코요테 타임, 점프 버퍼, 가변 점프). 카메라가 따라감 |
| 순찰 이동 | 벽이나 낭떠러지에서 방향 전환 |
| 수집 아이템 | 닿으면 점수 획득 |
| 위험 요소 | 닿으면 사망. "밟아서 처치 가능"이면 위에서 밟아 제거 |
| 점프대 | 위에서 밟으면 높이 튕겨 오름 |
| 목표 지점 | 닿으면 다음 씬으로 (마지막이면 클리어 화면) |
| 스크립트 | 직접 작성하는 JavaScript 동작 |

### 스크립트 작성법

```js
// self: 이 오브젝트 (self.pos, self.size, self.body, self.destroy())
// game: { input, dt, time, score, find(name), findByTag(tag), log(msg), restart(), goto(sceneName) }
return {
  start(self, game) {
    this.originX = self.pos.x;
  },
  update(self, dt, game) {
    self.pos.x = this.originX + Math.sin(game.time * 2) * 32;
    if (game.input.wasPressed('KeyF')) game.log('F 키!');
  },
};
```

## 구조

| 경로 | 역할 |
| --- | --- |
| `editor/main.js` | 에디터 상태, 패널 갱신, 단축키, 실행/정지, 저장·열기·내보내기 |
| `editor/sceneView.js` | 씬 편집 캔버스 (격자, 이동/확대, 선택·드래그·크기 조절, 칠하기/지우기) |
| `editor/inspector.js` | 속성/컴포넌트 편집 UI (전문가 모드) |
| `editor/easyPanel.js` | 쉬운 모드의 꾸미기 패널 (색깔·크기·슬라이더) |
| `editor/project.js` | 프로젝트 데이터 모델, 프리팹, 실행 취소 기록 |
| `editor/exporter.js` | 엔진 소스를 묶어 단일 HTML 게임 파일 생성 |
| `engine/Engine.js` | 고정 타임스텝(기본 60Hz) 게임 루프, 씬 전환, 일시정지 |
| `engine/Scene.js` | 엔티티 관리, 물리 스텝, 카메라, 렌더링 순서(z) |
| `engine/Entity.js` | 엔티티(위치·크기·태그)와 컴포넌트 시스템 |
| `engine/Physics.js` | 중력, AABB 충돌, 축 분리 충돌 해소 (`solid` 태그와 충돌) |
| `engine/behaviors.js` | 에디터용 컴포넌트 정의 (인스펙터 필드 + 런타임 생성) |
| `engine/GameRuntime.js` | 프로젝트 JSON → 실행 가능한 씬 (수집/위험/목표 규칙, 점수, 씬 이동) |
| `engine/Camera.js` | 부드러운 추적, 월드 경계 제한, 화면 흔들림 |
| `engine/Renderer.js` | Canvas 2D 래퍼(사각형·원·이미지·텍스트), `Shape` 컴포넌트 |
| `engine/Input.js` | 키보드/마우스, "이번 프레임에 눌림" 판정, 가상 키 입력 |
| `engine/TouchControls.js` | 태블릿/휴대폰용 화면 버튼 (◀ ▶ 점프) |
| `engine/Tilemap.js` | 문자열 배열 레벨 → 엔티티 변환 |
| `engine/Assets.js` | 이미지/사운드/JSON 프리로더 |
| `engine/Synth.js` | 에셋 없이 효과음을 만드는 WebAudio 신시사이저 |
| `engine/Vec2.js` | 2D 벡터 수학 |

## 코드로 직접 쓰기 (최소 예제)

에디터 없이 엔진을 라이브러리처럼 쓸 수도 있습니다.

```js
import { Engine, Scene, Entity, Body, Shape } from './engine/index.js';

class MyScene extends Scene {
  enter() {
    this.spawn(new Entity({ x: 0, y: 300, w: 640, h: 20, tags: ['solid'] })
      .add(new Shape({ color: '#555' })));
    this.box = this.spawn(new Entity({ x: 100, y: 0, w: 20, h: 20 })
      .add(new Body()).add(new Shape({ color: 'tomato' })));
  }
  update(dt) {
    this.box.get(Body).vel.x = this.input.axisX() * 200;
    if (this.input.wasPressed('Space') && this.box.get(Body).onGround) this.box.get(Body).vel.y = -600;
    super.update(dt);
  }
}

new Engine(document.querySelector('canvas')).start(new MyScene());
```

## 다음 단계 아이디어

- 이미지/스프라이트 에셋 가져오기와 애니메이션 컴포넌트
- 사운드 에셋, 텍스트/UI 오브젝트
- 공간 분할로 충돌 최적화 (큰 레벨 대응)
- Electron/Tauri로 데스크톱 앱 패키징

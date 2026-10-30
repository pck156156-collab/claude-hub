# claude-hub — 경량 2D 게임 엔진

브라우저에서 바로 돌아가는 **의존성 없는 2D 게임 엔진**입니다. 빌드 도구 없이 ES 모듈과 HTML5 Canvas만 사용합니다.

## 실행

```bash
npm start            # = python3 -m http.server 8000
```

브라우저에서 <http://localhost:8000/examples/platformer/> 를 열면 예제 게임 **별빛 탐험**을 플레이할 수 있습니다.
(ES 모듈은 `file://`로 열면 동작하지 않으니 로컬 서버를 꼭 사용하세요.)

```bash
npm test             # 엔진 단위 테스트 (Node 18+)
```

## 구조

| 파일 | 역할 |
| --- | --- |
| `engine/Engine.js` | 고정 타임스텝(기본 60Hz) 게임 루프, 씬 전환, 일시정지 |
| `engine/Scene.js` | 엔티티 관리, 물리 스텝, 카메라, 렌더링 순서(z) |
| `engine/Entity.js` | 엔티티(위치·크기·태그)와 컴포넌트 시스템 |
| `engine/Physics.js` | 중력, AABB 충돌, 축 분리 충돌 해소 (`solid` 태그와 충돌) |
| `engine/Camera.js` | 부드러운 추적, 월드 경계 제한, 화면 흔들림 |
| `engine/Renderer.js` | Canvas 2D 래퍼(사각형·원·이미지·텍스트), `Shape` 컴포넌트 |
| `engine/Input.js` | 키보드/마우스, "이번 프레임에 눌림" 판정 |
| `engine/Tilemap.js` | 문자열 배열 레벨 → 엔티티 변환 |
| `engine/Assets.js` | 이미지/사운드/JSON 프리로더 |
| `engine/Synth.js` | 에셋 없이 효과음을 만드는 WebAudio 신시사이저 |
| `engine/Vec2.js` | 2D 벡터 수학 |

## 최소 예제

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

## 커스텀 컴포넌트

`Component`를 상속하고 `update(dt, { input, scene, engine })` 와 `render(renderer)` 중 필요한 것을 구현해서 `entity.add(...)`로 붙이면 됩니다. 예제 게임의 `PlayerController`(코요테 타임·점프 버퍼·가변 점프)와 `Patrol`(낭떠러지 감지 순찰)을 참고하세요.

## 다음 단계 아이디어

- 스프라이트 시트 애니메이션 컴포넌트
- 타일 충돌 최적화(공간 분할 그리드)
- 씬 전환 효과(페이드), 저장/불러오기
- 간단한 레벨 에디터

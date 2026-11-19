/**
 * 차량 컨트롤러 인터페이스:
 *   update(dt, vehicle) → { throttle 0~1, brake 0~1, steer -1(좌)~1(우), handbrake bool }
 *
 * Vehicle 은 입력 장치를 알지 못하고 이 controls 객체만 받는다.
 * 이후 AI 차량은 같은 형태의 값을 반환하는 AIController 를 만들어 연결하면 된다.
 */
export class PlayerController {
  constructor(input) {
    this.input = input;
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  }

  update() {
    const i = this.input;
    const c = this.controls;
    c.throttle = i.isDown('KeyW', 'ArrowUp') ? 1 : 0;
    c.brake = i.isDown('KeyS', 'ArrowDown') ? 1 : 0;
    c.steer = (i.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (i.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    // Space 외에 Shift 도 핸드브레이크: 일반 키보드는 W+A+Space 같은 조합을 동시에 인식하지 못하는 경우가 많다(고스팅)
    c.handbrake = i.isDown('Space', 'ShiftLeft', 'ShiftRight');
    return c;
  }
}

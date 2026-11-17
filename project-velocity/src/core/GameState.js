/**
 * 게임 상태 머신. 시작 화면·주행·일시정지·오류를 하나의 상태값으로 관리한다.
 *
 *   title ──start──▶ playing ◀──resume── paused
 *                       └──────pause──────▶
 *   (모든 상태) ──contextlost──▶ error ──restored──▶ paused (또는 title)
 *
 * 물리 시뮬레이션은 playing 상태에서만 진행된다.
 */
export const STATE = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ERROR: 'error',
});

const TRANSITIONS = {
  [STATE.TITLE]: [STATE.PLAYING, STATE.ERROR],
  [STATE.PLAYING]: [STATE.PAUSED, STATE.ERROR],
  [STATE.PAUSED]: [STATE.PLAYING, STATE.TITLE, STATE.ERROR],
  [STATE.ERROR]: [STATE.PAUSED, STATE.TITLE],
};

export class GameState {
  constructor(initial = STATE.TITLE) {
    this.current = initial;
    this.previous = null;
    this.reason = '';
    this.listeners = [];
  }

  is(state) {
    return this.current === state;
  }

  can(next) {
    return TRANSITIONS[this.current]?.includes(next) ?? false;
  }

  /** 허용된 전환만 수행. 성공 여부 반환 */
  set(next, reason = '') {
    if (next === this.current || !this.can(next)) return false;
    this.previous = this.current;
    this.current = next;
    this.reason = reason;
    for (const fn of this.listeners) fn(next, this.previous, reason);
    return true;
  }

  onChange(fn) {
    this.listeners.push(fn);
  }
}

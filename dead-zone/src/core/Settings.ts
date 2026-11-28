import { DifficultyId } from '../config/GameConfig';

/** 게임 설정 (소리 · 그래픽 품질은 각자 저장, 여기는 그 밖의 설정) */
export interface GameSettings {
  difficulty: DifficultyId;
  /** 화면 흔들림 세기 0~1 (0 = 끔) */
  shake: number;
  /** 데미지 숫자 표시 */
  damageNumbers: boolean;
}

const KEY = 'project-dead-zone.settings';
const DEFAULTS: GameSettings = { difficulty: 'normal', shake: 1, damageNumbers: true };

/** 저장된 설정 읽기. 저장소를 못 쓰거나 값이 이상하면 기본값 (게임은 그대로 실행) */
export function loadSettings(): GameSettings {
  const s: GameSettings = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v.difficulty === 'easy' || v.difficulty === 'normal' || v.difficulty === 'hard') s.difficulty = v.difficulty;
      if (typeof v.shake === 'number' && Number.isFinite(v.shake)) s.shake = Math.max(0, Math.min(1, v.shake));
      if (typeof v.damageNumbers === 'boolean') s.damageNumbers = v.damageNumbers;
    }
  } catch { /* 저장소 접근 불가 · 손상된 값 → 기본값 */ }
  return s;
}

/** 저장 (실패해도 무시) */
export function saveSettings(s: GameSettings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

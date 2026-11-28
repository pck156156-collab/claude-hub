/** 개인 최고 기록 (브라우저 localStorage). 저장 · 읽기에 실패해도 게임은 계속된다. */
export interface RecordSet {
  time: number;
  wave: number;
  kills: number;
}

export interface RecordResult {
  best: RecordSet;
  newTime: boolean;
  newWave: boolean;
  newKills: boolean;
}

const KEY = 'project-dead-zone.records';

export class Records {
  best: RecordSet = { time: 0, wave: 0, kills: 0 };
  /** 저장소를 쓸 수 없는 환경이면 false (이번 세션 동안만 기억) */
  persistent = true;

  /** 난이도별 기록 (보통 = 기존 저장 키 그대로) */
  private key = KEY;

  constructor(mode = 'normal') {
    this.setMode(mode);
  }

  setMode(mode: string): void {
    this.key = mode === 'normal' ? KEY : `${KEY}.${mode}`;
    this.best = { time: 0, wave: 0, kills: 0 };
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        const v = JSON.parse(raw) as Partial<RecordSet>;
        this.best = { time: num(v.time), wave: num(v.wave), kills: num(v.kills) };
      }
    } catch {
      this.persistent = false;
    }
  }

  /** 이번 판 결과 반영. 항목별로 더 좋으면 갱신 */
  submit(run: RecordSet): RecordResult {
    const r: RecordResult = {
      best: this.best,
      newTime: run.time > this.best.time,
      newWave: run.wave > this.best.wave,
      newKills: run.kills > this.best.kills,
    };
    this.best = {
      time: Math.max(this.best.time, run.time),
      wave: Math.max(this.best.wave, run.wave),
      kills: Math.max(this.best.kills, run.kills),
    };
    r.best = this.best;
    try {
      localStorage.setItem(this.key, JSON.stringify(this.best));
    } catch {
      this.persistent = false;
    }
    return r;
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

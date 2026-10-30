import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Body } from '../engine/Physics.js';
import { buildEntity, computeBounds } from '../engine/GameRuntime.js';
import { createDefaultProject, instantiate, History } from '../editor/project.js';
import { ENGINE_FILES, bundleEngine, buildGameHtml } from '../editor/exporter.js';

test('프리팹 데이터가 런타임 엔티티로 변환된다', () => {
  const enemy = buildEntity(instantiate('enemy', 2, 3, 16));
  assert.ok(enemy.is('hazard') && enemy.is('stompable'));
  assert.ok(enemy.body instanceof Body);
  assert.equal(enemy.pos.x, 34);

  const wall = buildEntity(instantiate('wall', 0, 0, 16));
  assert.ok(wall.is('solid'));
  assert.equal(wall.body, undefined);

  const player = buildEntity(instantiate('player', 0, 0, 16));
  assert.ok(player.is('player'));
});

test('기본 프로젝트에는 플레이어와 목표가 하나씩 있다', () => {
  const p = createDefaultProject();
  const ents = p.scenes[0].entities;
  assert.equal(ents.filter((d) => d.prefab === 'player').length, 1);
  assert.equal(ents.filter((d) => d.prefab === 'goal').length, 1);
  const b = computeBounds(ents);
  assert.equal(b.x, 0);
  assert.equal(b.w, 30 * 16);
});

test('실행 취소/다시 실행', () => {
  const h = new History();
  h.push('a'); h.push('b'); h.push('c');
  assert.equal(h.undo(), 'b');
  assert.equal(h.undo(), 'a');
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), 'b');
  h.push('d');
  assert.equal(h.redo(), null);
});

test('내보낸 게임 HTML의 스크립트가 문법적으로 올바르다', () => {
  const sources = Object.fromEntries(ENGINE_FILES.map((f) => [f, readFileSync(new URL(`../engine/${f}`, import.meta.url), 'utf8')]));
  const code = bundleEngine(sources);
  assert.ok(!/^\s*(import|export)\s/m.test(code), 'import/export 문이 남아 있으면 안 된다');
  const html = buildGameHtml(createDefaultProject(), code);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
});

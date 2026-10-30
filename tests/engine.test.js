import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vec2 } from '../engine/Vec2.js';
import { Entity } from '../engine/Entity.js';
import { Body, PhysicsWorld, overlaps } from '../engine/Physics.js';
import { parseTilemap } from '../engine/Tilemap.js';

test('Vec2 기본 연산', () => {
  const v = new Vec2(3, 4);
  assert.equal(v.length(), 5);
  assert.deepEqual(v.add(new Vec2(1, 1)), new Vec2(4, 5));
  const n = v.normalize();
  assert.ok(Math.abs(n.x - 0.6) < 1e-9 && Math.abs(n.y - 0.8) < 1e-9);
  assert.deepEqual(new Vec2().normalize(), new Vec2(0, 0));
  assert.deepEqual(Vec2.lerp(new Vec2(0, 0), new Vec2(10, 20), 0.5), new Vec2(5, 10));
});

test('AABB 겹침 판정 (경계 맞닿음은 겹침 아님)', () => {
  const a = new Entity({ x: 0, y: 0, w: 10, h: 10 });
  assert.ok(overlaps(a, new Entity({ x: 5, y: 5, w: 10, h: 10 })));
  assert.ok(!overlaps(a, new Entity({ x: 10, y: 0, w: 10, h: 10 })));
});

test('중력으로 떨어져 바닥 위에 멈춘다', () => {
  const world = new PhysicsWorld({ gravity: 1000 });
  const floor = new Entity({ x: 0, y: 100, w: 200, h: 16, tags: ['solid'] });
  const box = new Entity({ x: 10, y: 0, w: 16, h: 16 }).add(new Body());
  for (let i = 0; i < 120; i++) world.step(1 / 60, [floor, box]);
  assert.equal(box.bottom, 100);
  assert.equal(box.get(Body).onGround, true);
  assert.equal(box.get(Body).vel.y, 0);
});

test('벽에 막혀 옆으로 통과하지 않는다', () => {
  const world = new PhysicsWorld({ gravity: 0 });
  const wall = new Entity({ x: 50, y: 0, w: 16, h: 100, tags: ['solid'] });
  const box = new Entity({ x: 0, y: 10, w: 16, h: 16 }).add(new Body({ gravity: false }));
  // 플레이어가 키를 누르고 있는 것처럼 매 스텝 속도를 준다.
  for (let i = 0; i < 30; i++) {
    box.get(Body).vel.x = 300;
    world.step(1 / 60, [wall, box]);
  }
  assert.equal(box.right, 50);
  assert.equal(box.get(Body).touching.right, true);
});

test('타일맵을 엔티티로 변환한다', () => {
  const map = parseTilemap(['#.#', '###'], {
    '#': (x, y, s) => new Entity({ x, y, w: s, h: s, tags: ['solid'] }),
  }, 8);
  assert.equal(map.entities.length, 5);
  assert.equal(map.width, 24);
  assert.equal(map.height, 16);
  assert.deepEqual(map.entities[1].pos, new Vec2(16, 0));
});

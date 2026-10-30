// 문자열 배열로 된 레벨을 엔티티 목록으로 바꾼다.
// legend: { '#': (x, y, size) => Entity, ... }  — 정의되지 않은 문자는 빈 칸.
export function parseTilemap(rows, legend, tileSize = 16) {
  const entities = [];
  rows.forEach((row, ty) => {
    [...row].forEach((ch, tx) => {
      const make = legend[ch];
      if (make) {
        const e = make(tx * tileSize, ty * tileSize, tileSize);
        if (e) entities.push(e);
      }
    });
  });
  const width = Math.max(...rows.map((r) => r.length)) * tileSize;
  const height = rows.length * tileSize;
  return { entities, width, height };
}

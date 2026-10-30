// 엔진 소스를 하나의 스크립트로 묶어, 프로젝트가 포함된 단일 HTML 게임 파일을 만든다.
// 엔진 파일은 의존 순서대로 나열해야 한다(import 문을 제거하고 이어 붙이기 때문).
export const ENGINE_FILES = [
  'Vec2.js', 'Entity.js', 'Physics.js', 'Camera.js', 'Renderer.js', 'Input.js',
  'Assets.js', 'Synth.js', 'Scene.js', 'Tilemap.js', 'Engine.js', 'behaviors.js', 'GameRuntime.js',
];

export function stripModule(src) {
  return src
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\}\s*(from\s+['"][^'"]+['"])?\s*;?\s*$/gm, '')
    .replace(/^export\s+(default\s+)?/gm, '');
}

export function bundleEngine(sources) {
  return ENGINE_FILES.map((name) => `// ---- ${name} ----\n${stripModule(sources[name])}`).join('\n');
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildGameHtml(project, engineCode) {
  const json = JSON.stringify(project).replace(/</g, '\\u003c');
  const start = Math.max(0, project.scenes.findIndex((s) => s.name === project.settings.startScene));
  const { width, height } = project.settings;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(project.name)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #0b0b10; }
  body { display: flex; align-items: center; justify-content: center; }
  canvas { width: min(100vw, calc(100vh * ${width} / ${height})); aspect-ratio: ${width} / ${height}; image-rendering: pixelated; }
</style>
</head>
<body>
<canvas id="game"></canvas>
<script>
(() => {
${engineCode.replace(/<\/script/gi, '<\\/script')}
const project = ${json};
const engine = new Engine(document.getElementById('game'), { width: ${width}, height: ${height} });
engine.start(new GameScene(project, ${start}));
})();
</script>
</body>
</html>
`;
}

export async function loadEngineSources(base = '../engine/') {
  const entries = await Promise.all(ENGINE_FILES.map(async (name) => {
    const res = await fetch(base + name);
    if (!res.ok) throw new Error(`${name} 을(를) 불러오지 못했습니다 (${res.status})`);
    return [name, await res.text()];
  }));
  return Object.fromEntries(entries);
}

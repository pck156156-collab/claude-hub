// Build the game and write dist/iron-raid/iron-raid.html, a fragment page for publishing as an Artifact.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execSync('npx vite build games/iron-raid --base ./ --outDir ../../dist/iron-raid --emptyOutDir --logLevel warn', { stdio: 'inherit', cwd: new URL('../..', import.meta.url).pathname });
const built = readFileSync(new URL('../../dist/iron-raid/index.html', import.meta.url), 'utf8');
const src = built.match(/src="(\.\/assets\/[^"]+\.js)"/)[1];
const page = `<title>IRON RAID</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; background: #0d0f14; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; }
  canvas { image-rendering: pixelated; }
</style>
<script type="module" crossorigin src="${src}"></script>
`;
writeFileSync(new URL('../../dist/iron-raid/iron-raid.html', import.meta.url), page);
console.log('wrote dist/iron-raid/iron-raid.html ->', src);

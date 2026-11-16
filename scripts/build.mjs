// Empaqueta los puntos de entrada del bridge y el widget en dist/.

import { build, transform } from 'esbuild';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    bridge: 'src/bridge/main.ts',
    ctl: 'src/bridge/ctl.ts',
    setup: 'src/bridge/setup.ts',
  },
  outdir: dist,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

// Widget: un solo bloque de HTML con su CSS y su JS dentro, para pegarlo en el widget "Custom HTML".
const widgetJs = await build({
  absWorkingDir: root,
  entryPoints: ['src/widget/main.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
});
const widgetCss = await transform(readFileSync(join(root, 'src/widget/styles/widget.css'), 'utf8'), {
  loader: 'css',
  minify: true,
});
// Un "</script" dentro del código cerraría el bloque antes de tiempo.
const js = widgetJs.outputFiles[0].text.trim().replace(/<\/script/gi, '<\\/script');
const css = widgetCss.code.trim().replace(/<\/style/gi, '<\\/style');
const template = readFileSync(join(root, 'src/widget/index.html'), 'utf8');
if (!template.includes('/*CSS*/') || !template.includes('/*JS*/')) throw new Error('faltan los marcadores en src/widget/index.html');
// Reemplazo con función: así un "$" en el código no se interpreta como patrón.
const html = template.replace('/*CSS*/', () => css).replace('/*JS*/', () => js);
writeFileSync(join(dist, 'widget.html'), html);
console.log(`  dist/widget.html ${(Buffer.byteLength(html) / 1024).toFixed(1)}kb`);

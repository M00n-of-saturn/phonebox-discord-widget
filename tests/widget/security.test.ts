import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FORBIDDEN = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function'];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

test('el código del widget no usa APIs que interpreten texto como HTML o código', () => {
  const files = filesUnder(join(root, 'src', 'widget'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const word of FORBIDDEN) assert.ok(!text.includes(word), `${file} contiene ${word}`);
  }
});

test('dist/widget.html es un solo bloque local, sin cierres de script extra y de menos de 64 KB', () => {
  execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'pipe' });
  const html = readFileSync(join(root, 'dist', 'widget.html'), 'utf8');
  assert.equal(html.match(/<\/script/gi)?.length, 1, 'debe haber un único cierre de script');
  assert.ok(html.trimEnd().endsWith('</script>'), 'el cierre de script debe ser el final');
  assert.ok(!/https?:\/\//i.test(html), 'el widget no debe cargar nada de internet');
  assert.ok(Buffer.byteLength(html) < 64 * 1024, `pesa ${Buffer.byteLength(html)} bytes`);
  assert.ok(!html.includes('/*CSS*/') && !html.includes('/*JS*/'), 'quedaron marcadores sin reemplazar');
  assert.equal(html.split('data-lang="en"').length - 1, 1, 'data-lang="en" debe aparecer exactamente una vez');
  for (const word of FORBIDDEN) assert.ok(!html.includes(word), `widget.html contiene ${word}`);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const dist = new URL('../../crates/fallout_web/dist/', import.meta.url);
export const assets = ['index.html', 'index.js', 'editor.html', 'editor.js', 'rpu-editor.js',
  'rpu-resource-declaration.example.json', 'fallout-se-web.js', 'fallout-se-web_bg.wasm',
  'fallout-se-web.d.ts', 'fallout-se-web_bg.wasm.d.ts'];
for (const name of assets) assert((await readFile(new URL(name, dist))).length > 0, `Empty asset: ${name}`);
const html = await readFile(new URL('index.html', dist), 'utf8');
assert(!html.includes('data-trunk'), 'Unprocessed Trunk directives');
assert(html.includes('<base href="./" />'), 'Missing relative base URL');
assert((await readFile(new URL('editor.js', dist), 'utf8')).includes('./rpu-editor.js'));
const declaration = JSON.parse(await readFile(new URL('rpu-resource-declaration.example.json', dist), 'utf8'));
assert.equal(declaration.accept_offline_assumptions, false);
// Load the actual generated bindings and WASM without any game data or DOM.
const js = await readFile(new URL('fallout-se-web.js', dist));
const wasm = await readFile(new URL('fallout-se-web_bg.wasm', dist));
const bindings = await import(`data:text/javascript;base64,${js.toString('base64')}`);
bindings.initSync({ module: wasm });
assert.equal(typeof bindings.RpuQuantityEditor, 'function');
assert.equal(typeof bindings.render_save_text, 'function');
for (const method of ['inspect', 'edit', 'receipt']) {
  assert.equal(typeof bindings.RpuQuantityEditor.prototype[method], 'function', `Missing RPU method ${method}`);
}
console.log(`Distribution verified: ${assets.length} assets; WASM initialized (${wasm.length} bytes).`);

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { assets, dist } from './verify-dist.mjs';

// Serve only generated assets on an ephemeral loopback port; never expose the repo.
const types = { html: 'text/html', js: 'text/javascript', wasm: 'application/wasm', json: 'application/json' };
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!assets.includes(name)) { res.writeHead(404); res.end(); return; }
  try {
    res.setHeader('Content-Type', types[name.split('.').pop()] ?? 'application/octet-stream');
    res.end(await readFile(new URL(name, dist)));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  const failures = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => failures.push(request.url()));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  // Avoid an automatic favicon request, which is unrelated to the app.
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/editor.html`);
  await page.waitForFunction(() => !document.getElementById('rpu-controls').disabled);
  await page.locator('#rpu-panel').evaluate(el => { el.open = true; });
  await page.waitForFunction(() => document.querySelector('.toolbar').inert);
  assert.match(await page.locator('#rpu-status').textContent(), /Choose a complete slot/);
  for (const id of ['slot', 'archive', 'master', 'plan', 'consent', 'inspect']) {
    assert(await page.locator(`#rpu-${id}`).isEnabled(), `${id} must be available`);
  }
  for (const id of ['apply', 'download', 'receipt']) assert(await page.locator(`#rpu-${id}`).isDisabled());
  await page.locator('#rpu-inspect').click();
  assert.match(await page.locator('#rpu-status').textContent(), /Blocked:.*offline resource assumptions/);
  await page.locator('#rpu-consent').check();
  await page.locator('#rpu-inspect').click();
  assert.match(await page.locator('#rpu-status').textContent(), /Blocked:.*Complete slot must include/);
  assert(await page.locator('#rpu-download').isDisabled());
  await page.locator('#rpu-panel').evaluate(el => { el.open = false; });
  await page.waitForFunction(() => !document.querySelector('.toolbar').inert);
  // Exercise the real WASM error boundary with test-owned malformed bytes.
  await page.locator('#file-input').setInputFiles({ name: 'SAVE.DAT', mimeType: 'application/octet-stream', buffer: Buffer.from('not a Fallout save') });
  await page.waitForFunction(() => /parse|fail|invalid|unsupported|error/i.test(document.getElementById('status').textContent));
  assert(await page.locator('#download-save').isDisabled());
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => /ready|drop|select|upload/i.test(document.getElementById('status').textContent));
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  assert.deepEqual(failures, [], 'Failed asset requests');
  console.log(`Browser smoke passed: Chromium ${browser.version()}; startup, WASM, RPU controls, rejection and legacy restoration.`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

// Opt-in real-resource browser regression. Downloads go only to test-owned temp files.
// Usage: FALLOUT_RPU_REAL_TEST=1 node tools/browser/rpu-real-resource.cjs URL SLOT_FOLDER RPU_DAT MASTER_DAT [CHROME_PATH]
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
(async () => {
  assert.equal(process.env.FALLOUT_RPU_REAL_TEST, '1', 'Explicit opt-in required: FALLOUT_RPU_REAL_TEST=1');
  process.chdir(path.resolve(__dirname, '../..'));
  const [url, slot, rpu, master, executablePath] = process.argv.slice(2);
  if (url) assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Use a trusted loopback server');
  assert(url && slot && rpu && master, 'Provide URL, staged candidate folder, and both archive paths.');
  const original = fs.readFileSync(path.join(slot, 'SAVE.DAT'));
  const originalHash = crypto.createHash('sha256').update(original).digest('hex');
  assert.equal(originalHash, 'd8e064a74970736939d3ec1fad31b5df13c7b139eac127a2b16f5313d2bf91e0');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rpu-browser-test-'));
  const browser = await chromium.launch({ executablePath: executablePath || undefined, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(url);
    await page.locator('#rpu-controls').waitFor({ state: 'attached' });
    await page.waitForFunction(() => !document.getElementById('rpu-controls').disabled);
    await page.locator('#rpu-panel').evaluate(el => { el.open = true; });
    await page.locator('#rpu-slot').setInputFiles(path.resolve(slot));
    await page.locator('#rpu-archive').setInputFiles(path.resolve(rpu));
    await page.locator('#rpu-master').setInputFiles(path.resolve(master));
    await page.locator('#rpu-plan').setInputFiles(path.resolve('crates/fallout_web/rpu-resource-declaration.example.json'));
    await page.locator('#rpu-consent').check();
    await page.locator('#rpu-inspect').click();
    await page.waitForFunction(() => /Verified 2 inventory objects|Blocked:/.test(document.getElementById('rpu-status').textContent), { timeout: 180000 });
    const status = await page.locator('#rpu-status').textContent();
    assert.match(status, /Verified 2 inventory objects/);
    const view = JSON.parse(await page.locator('#rpu-evidence').textContent());
    assert.deepEqual(view.handler5, [36416,36744]);
    assert.equal(view.rows[1].selection.pid, 7);
    assert.equal(view.rows[1].selection.object_id, 11);
    assert.deepEqual(view.rows[1].selection.path,[1]);
    assert.equal(view.rows[1].selection.expected_quantity,10001);
    assert(await page.locator('.toolbar').evaluate(el => el.inert), 'Legacy controls must be inert in RPU mode');
    await page.locator('#rpu-rows input[type=radio]').nth(1).check();
    for (const invalid of ['', '0','-1','1.5','1e4','2147483648',' 12']) {
      await page.locator('#rpu-quantity').fill(invalid);
      assert(await page.locator('#rpu-apply').isDisabled(), `Must block ${invalid}`);
      assert(await page.locator('#rpu-download').isDisabled());
    }
    await page.locator('#rpu-quantity').fill('10002');
    await page.locator('#rpu-apply').click();
    assert.equal(await page.locator('#rpu-download').isDisabled(), false, await page.locator('#rpu-status').textContent());
    const receipt = JSON.parse(await page.locator('#rpu-evidence').textContent());
    assert.equal(receipt.verified,true);
    assert.deepEqual(receipt.quantity_span,[36640,36644]);
    assert.deepEqual(receipt.changed_offsets,[36643]);
    const waiting = page.waitForEvent('download');
    await page.locator('#rpu-download').click();
    const download = await waiting;
    assert.equal(download.suggestedFilename(),'RPU-quantity-edited-SAVE.DAT');
    const outputPath = path.join(temp,download.suggestedFilename());
    await download.saveAs(outputPath);
    const output=fs.readFileSync(outputPath);
    assert.equal(output.length, original.length);
    assert.equal(output.readInt32BE(36640),10002);
    assert(output.subarray(0,36640).equals(original.subarray(0,36640)));
    assert(output.subarray(36644).equals(original.subarray(36644)));
    assert.equal(crypto.createHash('sha256').update(output).digest('hex'),receipt.output_sha256);
    const receiptWaiting=page.waitForEvent('download');
    await page.locator('#rpu-receipt').click();
    await (await receiptWaiting).saveAs(path.join(temp,'receipt.json'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp,'receipt.json'),'utf8')),receipt);
    await page.locator('#rpu-panel').screenshot({ path: path.join(temp, 'rpu-browser-mvp.png') });
    // Editing another row clears the previously offered output.
    await page.locator('#rpu-rows input[type=radio]').nth(0).check();
    assert(await page.locator('#rpu-download').isDisabled());
    await page.locator('#rpu-consent').uncheck();
    assert(await page.locator('#rpu-apply').isDisabled());
    assert.equal(await page.locator('#rpu-rows input').count(),0);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(slot,'SAVE.DAT'))).digest('hex'),originalHash);
    // A wrong declared archive digest blocks the whole workflow, without fallback.
    const badPlan=JSON.parse(fs.readFileSync('crates/fallout_web/rpu-resource-declaration.example.json','utf8'));
    badPlan.rpu_sha256='0'.repeat(64);
    await page.locator('#rpu-plan').setInputFiles({name:'bad-plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(badPlan))});
    await page.locator('#rpu-consent').check();
    await page.locator('#rpu-inspect').click();
    await page.waitForFunction(() => document.getElementById('rpu-status').textContent.startsWith('Blocked:'), { timeout: 180000 });
    assert.match(await page.locator('#rpu-status').textContent(),/SHA-256 differs/);
    assert(await page.locator('#rpu-download').isDisabled());
    assert.equal(await page.locator('#rpu-rows input').count(),0);
    // Closing experimental mode restores the existing legacy F1/F2 upload workflow.
    await page.locator('#rpu-panel').evaluate(el => { el.open=false; });
    await page.waitForFunction(() => !document.querySelector('.toolbar').inert);
    for (const fixture of ['tests/fallout1_examples/SAVEGAME/SLOT01/SAVE.DAT','tests/fallout2_examples/SLOT01/SAVE.DAT']) {
      await page.locator('#file-input').setInputFiles(path.resolve(fixture));
      await page.waitForFunction(() => !document.getElementById('apply-json').disabled);
      assert(JSON.parse(await page.locator('#json-editor').inputValue()).inventory.length>0);
    }
    assert.deepEqual(errors,[]);
    const result={passed:true,browser:await browser.version(),source_sha256:originalHash,receipt,downloads:temp};
    fs.writeFileSync(path.join(temp, 'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(result,null,2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });

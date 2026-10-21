import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { binaryFlight } from './fixtures.js';

// Test a single HTML response, blocking every dependency request. This tests
// self-containment without bypassing the managed browser's file:// restrictions.
const html = await readFile('dist-offline/index.html', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
const page = await browser.newPage();
const errors = [], requests = [];
const url = 'http://127.0.0.1:4173/standalone-test';
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', async route => {
  if (route.request().url() === url) await route.fulfill({ contentType: 'text/html', body: html });
  else { requests.push(route.request().url()); await route.abort(); }
});
try {
  await page.goto(url);
  await page.getByRole('button', { name: 'Открыть демо' }).click();
  await page.getByRole('heading', { name: 'Что поправить' }).waitFor();
  assert.ok(await page.locator('.recommendation').count() > 0);
  await page.getByLabel('Загрузить Blackbox', { exact: true }).setInputFiles({ name: 'test.bbl', mimeType: 'application/octet-stream', buffer: Buffer.from(binaryFlight()) });
  await page.getByRole('heading', { name: 'Что поправить' }).waitFor();
  await page.getByRole('button', { name: 'Плавный', exact: false }).click();
  await page.getByRole('heading', { name: 'Цель: плавный отклик' }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log('Standalone HTML: demo, native Blackbox and pilot preferences passed; no dependency requests.');
} finally { await browser.close(); }

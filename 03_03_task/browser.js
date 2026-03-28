import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = join(__dirname, 'data', 'screenshots');

let browser = null;
let page = null;

export async function launchPreview(url) {
  await mkdir(SCREENSHOTS_DIR, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = context.pages()[0] ?? await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  console.log('  [browser] Reactor preview loaded');
}

export async function takeScreenshot(label) {
  if (!page) return null;
  await mkdir(SCREENSHOTS_DIR, { recursive: true });
  const filename = `${label ?? `step-${Date.now()}`}.png`;
  const filepath = join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

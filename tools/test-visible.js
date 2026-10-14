const { chromium } = require('playwright');
const os = require('os');
const path = require('path');

async function test() {
  const profileDir = path.join(os.tmpdir(), `whop_vis_${Date.now()}`);
  console.log('Launching browser with visible window...');
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    args: ['--start-maximized', '--new-window'],
  });
  const page = context.pages()[0] || await context.newPage();
  console.log('Navigating to https://whop.com...');
  await page.goto('https://whop.com', { waitUntil: 'domcontentloaded' });
  console.log('Successfully navigated! Waiting 10 seconds...');
  await new Promise(r => setTimeout(r, 10000));
  await context.close();
  console.log('Done test.');
}

test().catch(console.error);

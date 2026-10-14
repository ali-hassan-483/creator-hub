const { execSync, spawn } = require('child_process');
const { chromium } = require('playwright');
const os = require('os');
const path = require('path');
const fs = require('fs');

async function testCDP() {
  const port = 9333;
  const tmpDir = path.join(os.tmpdir(), `whop_cdp_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  console.log('Launching Chrome via cmd.exe start with remote debugging port', port);

  // Use cmd /c start to launch in user's active GUI session
  const cmd = `start "" "${chromePath}" --remote-debugging-port=${port} --user-data-dir="${tmpDir}" --incognito --start-maximized "about:blank"`;
  execSync(`cmd.exe /c "${cmd}"`);

  console.log('Waiting 2 seconds for Chrome to bind CDP port...');
  await new Promise(r => setTimeout(r, 2000));

  console.log('Connecting Playwright over CDP...');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  console.log('Connected over CDP!');

  const contexts = browser.contexts();
  const context = contexts[0];

  console.log('Adding test cookie...');
  await context.addCookies([{
    name: 'test_token',
    value: 'secret123',
    domain: '.whop.com',
    path: '/'
  }]);

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log('Navigating page to https://whop.com...');
  await page.goto('https://whop.com', { waitUntil: 'domcontentloaded' });
  console.log('Navigation completed!');

  console.log('Disconnecting Playwright (leaving Chrome window open)...');
  await browser.disconnect();
  console.log('Test successful! Chrome window is open and decoupled.');
}

testCDP().catch(console.error);

/**
 * open-whop-incognito.js
 * 
 * Standard Playwright Chrome browser launcher with clean incognito context.
 * Injects Whop cookies/localStorage and keeps browser open for manual interaction.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const logFile = path.join(process.cwd(), 'open-whop-last.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line, 'utf8'); } catch (e) {}
  console.log(msg);
}

async function main() {
  log('=== Starting Whop Browser Launcher (Clean Headed Chrome) ===');

  // Read cookies payload if passed
  const jsonPath = process.argv[2];
  let rawCookies = null;
  let targetUrl = 'https://whop.com';

  if (jsonPath && fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      rawCookies = data.cookies;
      if (data.targetUrl) targetUrl = data.targetUrl;
      log(`Read payload from ${jsonPath}, hasCookies: ${!!rawCookies}`);
      try { fs.unlinkSync(jsonPath); } catch (e) {}
    } catch (err) {
      log(`Error reading payload: ${err.message}`);
    }
  }

  log('Launching Chrome with channel "chrome" and headed window...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run',
    ],
  });

  log('Creating browser context...');
  const context = await browser.newContext({
    viewport: null, // Let window use native maximized size
  });

  // Inject cookies
  if (rawCookies) {
    try {
      let cookieList = [];
      const parsed = typeof rawCookies === 'string' ? JSON.parse(rawCookies) : rawCookies;

      if (parsed && Array.isArray(parsed.cookies)) {
        cookieList = parsed.cookies;
      } else if (Array.isArray(parsed)) {
        cookieList = parsed;
      }

      if (cookieList.length > 0) {
        const sanitized = cookieList.map((c) => {
          let domain = c.domain || '.whop.com';
          if (!domain.includes('whop.com')) domain = '.whop.com';
          return {
            name: String(c.name),
            value: String(c.value),
            domain,
            path: c.path || '/',
            expires: typeof c.expires === 'number' ? c.expires : -1,
            httpOnly: !!c.httpOnly,
            secure: c.secure !== false,
            sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
          };
        });

        await context.addCookies(sanitized);
        log(`Successfully injected ${sanitized.length} session cookies.`);
      }

      // Inject localStorage via addInitScript
      if (parsed && Array.isArray(parsed.origins)) {
        for (const originItem of parsed.origins) {
          if (originItem.origin && Array.isArray(originItem.localStorage)) {
            await context.addInitScript(
              ({ origin, storage }) => {
                try {
                  if (window.location.origin === origin) {
                    for (const item of storage) {
                      localStorage.setItem(item.name, item.value);
                    }
                  }
                } catch (e) {}
              },
              { origin: originItem.origin, storage: originItem.localStorage }
            );
          }
        }
        log('Origins localStorage script injected.');
      }
    } catch (err) {
      log(`Cookie injection error: ${err.message}`);
    }
  }

  const page = await context.newPage();
  log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  }).catch((err) => log(`Navigation warning: ${err.message}`));

  log('Whop page loaded! Browser window is open.');

  // Wait until user closes the browser
  await new Promise((resolve) => {
    browser.on('disconnected', () => {
      log('Browser closed by user.');
      resolve();
    });
  });

  log('Launcher exiting cleanly.');
  process.exit(0);
}

main().catch((err) => {
  log(`Fatal launcher error: ${err.message}\n${err.stack}`);
  process.exit(1);
});

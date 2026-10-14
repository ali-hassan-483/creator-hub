/**
 * Tool 7: Whop Submitter Bot
 * 
 * Playwright browser bot that automatically submits approved video clips
 * to Whop submission channels.
 * 
 * Flow:
 * 1. Login to Whop (if required)
 * 2. Navigate to the campaign's submission channel URL
 * 3. Upload video file or paste YouTube/Drive link
 * 4. Fill title and description
 * 5. Submit and confirm
 * 6. Return submission result
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WhopSubmitOptions {
  submissionUrl: string     // Whop channel submission link from campaign
  videoPath?: string        // Local file path (if uploading)
  videoUrl?: string         // YouTube or Drive URL (if linking)
  title: string
  description?: string
  tags?: string[]
  headless?: boolean        // Run browser in headless mode (default: true)
  sessionCookies?: string   // JSON string of saved session cookies
}

export interface WhopSubmitResult {
  success: boolean
  submissionId?: string
  error?: string
  screenshotPath?: string   // Path to screenshot on error/success
}

// ─── Browser Helpers ──────────────────────────────────────────────────────────

let browser: Browser | null = null

async function getBrowser(headless = true): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    })
  }
  return browser
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
  }
}

async function takeScreenshot(page: Page, label: string, workDir: string): Promise<string> {
  const screenshotPath = path.join(workDir, `screenshot_${label}_${Date.now()}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  return screenshotPath
}

// ─── Cookie Management ────────────────────────────────────────────────────────

/**
 * Load saved Whop session cookies into browser context.
 */
async function loadCookies(context: BrowserContext, cookiesJson: string): Promise<void> {
  try {
    const cookies = JSON.parse(cookiesJson)
    await context.addCookies(cookies)
    console.log(`[Whop] ✅ Loaded ${cookies.length} session cookies`)
  } catch (error: any) {
    console.warn(`[Whop] ⚠️ Failed to load cookies: ${error.message}`)
  }
}

/**
 * Save current session cookies to JSON string (for reuse).
 */
export async function saveWhopCookies(page: Page): Promise<string> {
  const cookies = await page.context().cookies()
  return JSON.stringify(cookies)
}

// ─── Whop Navigation Helpers ──────────────────────────────────────────────────

/**
 * Wait for Whop page to be ready (not loading/redirecting).
 */
async function waitForWhopReady(page: Page, timeout = 15000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout })
}

/**
 * Check if user is logged into Whop.
 */
async function isLoggedInToWhop(page: Page): Promise<boolean> {
  await page.goto('https://whop.com/hub', { waitUntil: 'networkidle' })
  const url = page.url()
  return !url.includes('/login') && !url.includes('/signup')
}

// ─── Main Submission Function ─────────────────────────────────────────────────

/**
 * Submit a video clip to a Whop submission channel.
 */
export async function submitToWhop(
  options: WhopSubmitOptions,
  workDir = '/tmp/whop-bot'
): Promise<WhopSubmitResult> {
  const {
    submissionUrl,
    videoPath,
    videoUrl,
    title,
    description,
    headless = true,
    sessionCookies,
  } = options

  if (!submissionUrl) {
    return { success: false, error: 'submissionUrl is required' }
  }

  fs.mkdirSync(workDir, { recursive: true })

  let context: BrowserContext | null = null
  let page: Page | null = null

  try {
    const b = await getBrowser(headless)
    context = await b.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })

    // Load saved session cookies
    if (sessionCookies) {
      await loadCookies(context, sessionCookies)
    }

    page = await context.newPage()

    // Check auth status
    console.log(`[Whop] Checking login status...`)
    const loggedIn = await isLoggedInToWhop(page)
    
    if (!loggedIn) {
      const screenshotPath = await takeScreenshot(page, 'login_required', workDir)
      return {
        success: false,
        error: 'Not logged into Whop. Please provide valid session cookies.',
        screenshotPath,
      }
    }

    // Navigate to submission channel
    console.log(`[Whop] Navigating to submission URL: ${submissionUrl}`)
    await page.goto(submissionUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await waitForWhopReady(page)

    // Screenshot for debugging
    const navScreenshot = await takeScreenshot(page, 'navigation', workDir)
    console.log(`[Whop] Page loaded. Screenshot: ${navScreenshot}`)

    // Look for "Submit" or "Post" button
    const submitTriggers = [
      'button:has-text("Submit")',
      'button:has-text("Post")',
      'button:has-text("Add")',
      'button:has-text("Create")',
      'a:has-text("Submit")',
      '[data-testid="submit-button"]',
      '[data-testid="post-button"]',
    ]

    let submitButtonFound = false
    for (const selector of submitTriggers) {
      try {
        const btn = page.locator(selector).first()
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.click()
          submitButtonFound = true
          console.log(`[Whop] Clicked submit trigger: ${selector}`)
          break
        }
      } catch {}
    }

    if (!submitButtonFound) {
      // Try to find an input/textarea for direct submission
      const textInput = page.locator('textarea, [contenteditable="true"]').first()
      if (await textInput.isVisible({ timeout: 5000 })) {
        await textInput.click()
        await textInput.fill(title)
        console.log(`[Whop] Filled text input with title`)
      }
    }

    await page.waitForTimeout(1500)

    // Fill title field
    const titleSelectors = [
      'input[placeholder*="title" i]',
      'input[name="title"]',
      'input[placeholder*="name" i]',
      '[data-testid="title-input"]',
    ]

    for (const sel of titleSelectors) {
      try {
        const input = page.locator(sel).first()
        if (await input.isVisible({ timeout: 2000 })) {
          await input.fill(title)
          console.log(`[Whop] Filled title: "${title}"`)
          break
        }
      } catch {}
    }

    // Fill description if provided
    if (description) {
      const descSelectors = [
        'textarea[placeholder*="description" i]',
        'textarea[name="description"]',
        '[data-testid="description-input"]',
        '[contenteditable="true"]',
      ]
      for (const sel of descSelectors) {
        try {
          const input = page.locator(sel).first()
          if (await input.isVisible({ timeout: 2000 })) {
            await input.fill(description)
            console.log(`[Whop] Filled description`)
            break
          }
        } catch {}
      }
    }

    // Handle video — file upload or URL paste
    if (videoPath && fs.existsSync(videoPath)) {
      // File upload
      const fileInput = page.locator('input[type="file"]').first()
      if (await fileInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await fileInput.setInputFiles(videoPath)
        console.log(`[Whop] Uploaded file: ${path.basename(videoPath)}`)
        // Wait for upload to process
        await page.waitForTimeout(5000)
      } else {
        // Some platforms hide file input — click upload area
        const uploadArea = page.locator('[data-testid="upload-area"], .upload-area, [class*="upload"]').first()
        if (await uploadArea.isVisible({ timeout: 2000 }).catch(() => false)) {
          await uploadArea.click()
          await page.waitForTimeout(500)
          const fileInputAfter = page.locator('input[type="file"]').first()
          await fileInputAfter.setInputFiles(videoPath)
          await page.waitForTimeout(5000)
        }
      }
    } else if (videoUrl) {
      // Paste URL
      const urlSelectors = [
        'input[placeholder*="url" i]',
        'input[placeholder*="link" i]',
        'input[type="url"]',
        '[data-testid="url-input"]',
      ]
      for (const sel of urlSelectors) {
        try {
          const input = page.locator(sel).first()
          if (await input.isVisible({ timeout: 2000 })) {
            await input.fill(videoUrl)
            console.log(`[Whop] Filled video URL: ${videoUrl}`)
            break
          }
        } catch {}
      }
    }

    await page.waitForTimeout(1000)

    // Find and click the final submit/confirm button
    const finalSubmitSelectors = [
      'button[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Post")',
      'button:has-text("Publish")',
      'button:has-text("Send")',
      'button:has-text("Confirm")',
      '[data-testid="final-submit"]',
    ]

    let submitted = false
    for (const sel of finalSubmitSelectors) {
      try {
        const btn = page.locator(sel).first()
        if (await btn.isVisible({ timeout: 2000 }) && await btn.isEnabled()) {
          await btn.click()
          submitted = true
          console.log(`[Whop] Clicked final submit: ${sel}`)
          break
        }
      } catch {}
    }

    if (!submitted) {
      // Press Enter as last resort
      await page.keyboard.press('Enter')
      submitted = true
      console.log(`[Whop] Pressed Enter to submit`)
    }

    // Wait for confirmation
    await page.waitForTimeout(3000)
    await waitForWhopReady(page, 10000)

    const successScreenshot = await takeScreenshot(page, 'success', workDir)
    const currentUrl = page.url()

    // Try to extract submission ID from URL or page
    const submissionId = currentUrl.match(/\/([a-zA-Z0-9_-]{8,})\/?$/)?.[1]

    console.log(`[Whop] ✅ Submission complete. URL: ${currentUrl}`)
    return {
      success: true,
      submissionId,
      screenshotPath: successScreenshot,
    }

  } catch (error: any) {
    const errMsg = error?.message || 'Unknown Whop submission error'
    console.error(`[Whop] ❌ ${errMsg}`)
    
    let screenshotPath: string | undefined
    if (page) {
      try {
        screenshotPath = await takeScreenshot(page, 'error', workDir)
      } catch {}
    }

    return { success: false, error: errMsg, screenshotPath }

  } finally {
    if (context) await context.close()
  }
}

// ─── Batch Submission ─────────────────────────────────────────────────────────

export interface BatchSubmitJob {
  clipPath: string
  title: string
  description?: string
}

/**
 * Submit multiple clips to a Whop channel, respecting daily post limit.
 */
export async function batchSubmitToWhop(
  jobs: BatchSubmitJob[],
  submissionUrl: string,
  dailyPostLimit: number,
  sessionCookies?: string,
  workDir = '/tmp/whop-batch'
): Promise<WhopSubmitResult[]> {
  const results: WhopSubmitResult[] = []
  const maxJobs = Math.min(jobs.length, dailyPostLimit)

  console.log(`[Whop-Batch] Submitting ${maxJobs} clips (daily limit: ${dailyPostLimit})`)

  for (let i = 0; i < maxJobs; i++) {
    const job = jobs[i]
    console.log(`[Whop-Batch] ${i + 1}/${maxJobs}: ${job.title}`)

    const result = await submitToWhop(
      {
        submissionUrl,
        videoPath: job.clipPath,
        title: job.title,
        description: job.description,
        headless: true,
        sessionCookies,
      },
      path.join(workDir, `job_${i}`)
    )

    results.push(result)

    if (!result.success) {
      console.error(`[Whop-Batch] Job ${i + 1} failed: ${result.error}`)
    }

    // Delay between submissions to avoid rate limiting
    if (i < maxJobs - 1) {
      const delay = 3000 + Math.random() * 2000
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  await closeBrowser()
  return results
}

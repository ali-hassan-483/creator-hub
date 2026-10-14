import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'

export async function triggerWhopIncognito(cookiesString?: string | null, targetUrl = 'https://whop.com') {
  const runnerScript = path.join(process.cwd(), 'tools', 'open-whop-incognito.js')

  // Write temporary payload
  const tmpFile = path.join(os.tmpdir(), `whop_session_${Date.now()}_${Math.random().toString(36).substring(7)}.json`)
  fs.writeFileSync(
    tmpFile,
    JSON.stringify({
      cookies: cookiesString || null,
      targetUrl: targetUrl || 'https://whop.com',
    }),
    'utf8'
  )

  const child = spawn(process.execPath, [runnerScript, tmpFile], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,  // suppress any console window flash on Windows
  })

  child.unref()
  return true
}

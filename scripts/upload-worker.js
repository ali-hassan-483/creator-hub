/**
 * Creator Hub — Dedicated Upload Worker Daemon
 *
 * Runs on Dedicated Upload Worker VPS nodes (and Main Server).
 * Performs isolated YouTube video uploads using the host's clean IP.
 * Requires Node.js 18+ (native fetch and stream support).
 */

const fs = require('fs')
const path = require('path')

// Load environment variables or .env file if present
function loadEnv() {
  const envPath = path.join(__dirname, '.env')
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim()
        const val = trimmed.slice(idx + 1).trim()
        if (!process.env[key]) {
          process.env[key] = val
        }
      }
    }
  }
}

loadEnv()

const SERVER_URL = (process.env.CREATOR_HUB_URL || 'https://creatorhub.chickenkiller.com').replace(/\/$/, '')
const API_KEY = process.env.VPS_API_KEY
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_SEC || '30', 10) * 1000

if (!API_KEY) {
  console.error('❌ [Worker] Error: VPS_API_KEY environment variable is missing!')
  console.error('Please configure VPS_API_KEY in .env or run setup-vps-worker.sh')
  process.exit(1)
}

console.log('───────────────────────────────────────────────────────')
console.log('🚀 Creator Hub — Dedicated Upload Worker')
console.log(`📡 Server:        ${SERVER_URL}`)
console.log(`🔑 VPS API Key:   ${API_KEY.slice(0, 10)}••••••••`)
console.log(`⏱️  Poll Interval: ${POLL_INTERVAL / 1000}s`)
console.log('───────────────────────────────────────────────────────')

/**
 * Sends heartbeat ping to Creator Hub to update online status.
 */
async function sendHeartbeat() {
  try {
    const res = await fetch(`${SERVER_URL}/api/worker/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: API_KEY }),
    })
    if (res.ok) {
      const data = await res.json()
      return data
    } else {
      const err = await res.text()
      console.warn(`⚠️ [Worker] Heartbeat warning (${res.status}): ${err}`)
    }
  } catch (err) {
    console.warn(`⚠️ [Worker] Heartbeat network error: ${err.message}`)
  }
  return null
}

/**
 * Exchanges Google OAuth refresh token for a fresh access token.
 */
async function getGoogleAccessToken(clientId, clientSecret, refreshToken) {
  const tokenUrl = 'https://oauth2.googleapis.com/token'
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${errText}`)
  }

  const data = await res.json()
  return data.access_token
}

/**
 * Downloads a video clip binary from Creator Hub to a local temporary file.
 */
async function downloadClip(downloadUrl, targetPath) {
  console.log(`⬇️  [Worker] Downloading clip stream from ${downloadUrl}...`)
  const res = await fetch(downloadUrl)
  if (!res.ok) {
    throw new Error(`Failed to download clip (${res.status}): ${res.statusText}`)
  }

  const fileStream = fs.createWriteStream(targetPath)
  const buffer = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(targetPath, buffer)

  const stats = fs.statSync(targetPath)
  console.log(`✅ [Worker] Clip downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)
  return stats.size
}

/**
 * Uploads a video clip to YouTube using the YouTube Data API v3 Resumable Upload protocol.
 */
async function uploadToYouTube(accessToken, videoPath, fileSize, metadata) {
  console.log(`📤 [Worker] Initializing YouTube Resumable Upload for: "${metadata.title}"...`)

  // Step 1: Initialize Resumable Upload Session
  const initUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'
  const initRes = await fetch(initUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': fileSize.toString(),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify({
      snippet: {
        title: metadata.title.slice(0, 100),
        description: metadata.description || '',
        tags: metadata.tags || ['shorts', 'viral'],
        categoryId: '22',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    }),
  })

  if (!initRes.ok) {
    const errText = await initRes.text()
    let isLimitExceeded = false
    try {
      const parsed = JSON.parse(errText)
      const reason = parsed?.error?.errors?.[0]?.reason
      if (reason === 'uploadLimitExceeded') {
        isLimitExceeded = true
      }
    } catch {}

    const err = new Error(`Failed to initialize YouTube upload session (${initRes.status}): ${errText}`)
    err.isLimitExceeded = isLimitExceeded
    err.rawResponse = errText
    throw err
  }

  const uploadLocation = initRes.headers.get('location')
  if (!uploadLocation) {
    throw new Error('YouTube did not return a resumable upload location header')
  }

  console.log('📡 [Worker] Upload session established. Sending video bytes...')

  // Step 2: Upload Binary Video Payload
  const fileBuffer = fs.readFileSync(videoPath)
  const uploadRes = await fetch(uploadLocation, {
    method: 'PUT',
    headers: {
      'Content-Length': fileSize.toString(),
      'Content-Type': 'video/mp4',
    },
    body: fileBuffer,
  })

  if (!uploadRes.ok) {
    const errText = await uploadRes.text()
    throw new Error(`YouTube video chunk upload failed (${uploadRes.status}): ${errText}`)
  }

  const videoData = await uploadRes.json()
  const videoId = videoData.id
  const youtubeLink = `https://youtube.com/shorts/${videoId}`

  console.log(`🎉 [Worker] Video successfully uploaded to YouTube! Video ID: ${videoId}`)
  console.log(`🔗 [Worker] Live Link: ${youtubeLink}`)

  return { videoId, youtubeLink }
}

/**
 * Reports upload completion back to Creator Hub.
 */
async function reportUploadComplete(job, videoId, youtubeLink) {
  console.log(`📝 [Worker] Reporting upload complete to Creator Hub...`)
  const res = await fetch(`${SERVER_URL}/api/worker/upload-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: API_KEY,
      automationId: job.automationId,
      channelId: job.channel.id,
      campaignId: job.campaign.id,
      youtubeVideoId: videoId,
      youtubeLink: youtubeLink,
      title: job.clip.title,
      clipFilename: job.clip.filename,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.warn(`⚠️ [Worker] Warning recording upload completion (${res.status}): ${errText}`)
  } else {
    console.log(`✅ [Worker] Upload successfully recorded in Creator Hub database.`)
  }
}

/**
 * Reports upload failure (e.g. YouTube limit exceeded) to Creator Hub.
 */
async function reportUploadFailure(job, reason, errorMessage) {
  try {
    await fetch(`${SERVER_URL}/api/worker/upload-failed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: API_KEY,
        channelId: job.channel.id,
        campaignId: job.campaign.id,
        reason,
        errorMessage,
        clipFilename: job.clip.filename,
      }),
    })
  } catch (err) {
    console.warn(`⚠️ [Worker] Could not report upload failure:`, err.message)
  }
}

/**
 * Main worker loop.
 */
async function pollAndProcess() {
  await sendHeartbeat()

  try {
    const pollUrl = `${SERVER_URL}/api/worker/poll-upload?apiKey=${encodeURIComponent(API_KEY)}`
    const res = await fetch(pollUrl)

    if (!res.ok) {
      const errText = await res.text()
      console.warn(`⚠️ [Worker] Poll failed (${res.status}): ${errText}`)
      return false
    }

    const data = await res.json()
    if (!data.hasJob || !data.job) {
      // No jobs pending
      return false
    }

    const { job } = data
    console.log(`\n🎯 [Worker] Received upload job:`)
    console.log(`   Channel:  ${job.channel.channelName} (${job.channel.channelHandle || job.channel.channelEmail})`)
    console.log(`   Campaign: ${job.campaign.name}`)
    console.log(`   Clip:     ${job.clip.filename}`)
    console.log(`   Title:    "${job.clip.title}"`)

    const tempDir = path.join(__dirname, 'temp')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const tempFilePath = path.join(tempDir, `upload_${Date.now()}_${path.basename(job.clip.filename)}`)

    try {
      // 1. Download clip stream
      const fileSize = await downloadClip(job.clip.downloadUrl, tempFilePath)

      // 2. Refresh Google Access Token
      console.log(`🔑 [Worker] Refreshing Google OAuth access token...`)
      const accessToken = await getGoogleAccessToken(
        job.channel.clientId,
        job.channel.clientSecret,
        job.channel.refreshToken
      )

      // 3. Upload to YouTube from this VPS node's clean IP
      const { videoId, youtubeLink } = await uploadToYouTube(accessToken, tempFilePath, fileSize, job.clip)

      // 4. Report back to Creator Hub
      await reportUploadComplete(job, videoId, youtubeLink)

      console.log(`✨ [Worker] Job finished successfully! Checking for more jobs...\n`)
      return true // Found and processed a job, check again immediately!

    } catch (uploadErr) {
      if (uploadErr.isLimitExceeded || uploadErr.message?.includes('uploadLimitExceeded')) {
        console.warn(`\n⏳ [Worker] YouTube daily upload limit reached for channel @${job.channel.channelHandle || job.channel.channelName}!`)
        console.warn(`   Channel is now placed on a 24-hour cooldown. Stopping upload attempts for this channel.\n`)
        await reportUploadFailure(job, 'uploadLimitExceeded', uploadErr.message)
      } else {
        console.error(`❌ [Worker] Error processing upload job:`, uploadErr.message)
        await reportUploadFailure(job, 'uploadError', uploadErr.message)
      }
      return false
    } finally {
      // Always cleanup local temporary video file
      if (fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath)
        } catch {}
      }
    }
  } catch (err) {
    console.error(`❌ [Worker] Poll loop error:`, err.message)
    return false
  }
}

// ─── Continuous Polling Loop ──────────────────────────────────────────────────
async function runLoop() {
  while (true) {
    const hadJob = await pollAndProcess()
    if (!hadJob) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL))
    } else {
      // If a job was processed, wait just 2s before looking for another
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

runLoop().catch((err) => {
  console.error('Fatal worker crash:', err)
  process.exit(1)
})

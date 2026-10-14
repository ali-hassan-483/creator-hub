/**
 * Tools Index — Creator Hub Automation Engine
 * Central export point for all 7 automation tools.
 */

// Tool 1: YouTube Downloader
export {
  downloadYouTubeVideo,
  downloadVideoURLs,
  getYouTubeVideoInfo,
} from './youtube-downloader'

// Tool 2: Google Drive Downloader
export {
  downloadDriveFile,
  downloadDriveUrls,
  downloadLogoOverlay,
  extractDriveFileId,
} from './drive-downloader'

// Tool 3: FFMPEG Video Editor
export {
  editVideoClip,
  getVideoDuration,
  getVideoInfo,
  generateMultiCutSlices,
  generateContinuousSlices,
  concatVideos,
} from './video-editor'

// Tool 4: Subtitle Generator
export {
  transcribeVideo,
  transcribeWithWhisper,
  transcribeWithGemini,
  generateAssSubtitles,
  burnSubtitlesIntoVideo,
  addSubtitlesToVideo,
} from './subtitle-generator'

// Tool 5: AI Clipper & Metadata Generator
export {
  findViralClips,
  generateTitle,
  generateDescription,
  generateOnScreenText,
  generateFullMetadata,
  parseCampaignBrief,
} from './ai-clipper'

// Tool 6: Discord Notifier
export {
  sendDiscordNotification,
  getYouTubeViewCount,
  checkViewThresholdAndNotify,
  notifyAutomationStarted,
  notifyAutomationCompleted,
  notifyAutomationFailed,
} from './discord-notifier'

// Tool 7: Whop Submitter
export {
  submitToWhop,
  batchSubmitToWhop,
  saveWhopCookies,
  closeBrowser,
} from './whop-submitter'

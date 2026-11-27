/**
 * Platform Configuration & Multi-Platform Campaign Helper
 * 
 * Supports both YouTube and Instagram with backward compatibility.
 * If campaign config does not have dedicated platform blocks, it falls back to root legacy fields.
 */

export type Platform = 'youtube' | 'instagram'

export const SUPPORTED_PLATFORMS: Platform[] = ['youtube', 'instagram']

export interface PlatformGuidelines {
  mention?: string
  cpm?: string | number
  minViews?: number
  onScreenTextGuide?: string
  titleGuide?: string         // Primarily YouTube video title
  captionGuide?: string       // Primarily Instagram Reel caption
  descriptionGuide?: string   // Video description
  maxTitleCharacters?: number
  onScreenMaxCharacters?: number
  ftcDisclosure?: string
  hashtagsGuide?: string
}

export interface CampaignMultiPlatformConfig {
  supportedPlatforms?: Platform[]
  // Dedicated configurations per platform
  youtube?: PlatformGuidelines
  instagram?: PlatformGuidelines

  // Root / Legacy fallback fields
  cpm?: string | number
  minViews?: number
  youtubeMentionChannel?: string
  instagramMention?: string
  titlesAiGuide?: string
  descriptionsAiGuide?: string
  onScreenTextAiGuide?: string
  maxTitleCharacters?: number
  onScreenMaxCharacters?: number
  ftcDisclosure?: string

  [key: string]: any
}

/**
 * Normalizes input string to a valid Platform, defaulting to 'youtube'
 */
export function normalizePlatform(val?: string | null): Platform {
  if (!val) return 'youtube'
  const clean = val.trim().toLowerCase()
  return clean === 'instagram' ? 'instagram' : 'youtube'
}

/**
 * Extracts supported platforms array from campaign config.
 * Defaults to ['youtube'] if not configured or empty.
 */
export function getCampaignPlatforms(config: any): Platform[] {
  if (!config || typeof config !== 'object') return ['youtube']

  // If explicitly specified
  if (Array.isArray(config.supportedPlatforms) && config.supportedPlatforms.length > 0) {
    const list = config.supportedPlatforms
      .map((p: any) => normalizePlatform(String(p)))
      .filter((p: Platform, idx: number, arr: Platform[]) => arr.indexOf(p) === idx)
    if (list.length > 0) return list
  }

  // Also check if config.platforms exists
  if (Array.isArray(config.platforms) && config.platforms.length > 0) {
    const list = config.platforms
      .map((p: any) => normalizePlatform(String(p)))
      .filter((p: Platform, idx: number, arr: Platform[]) => arr.indexOf(p) === idx)
    if (list.length > 0) return list
  }

  // If instagram block exists but supportedPlatforms is missing
  if (config.instagram && !config.youtube) {
    return ['instagram']
  }
  if (config.instagram && config.youtube) {
    return ['youtube', 'instagram']
  }

  return ['youtube']
}

/**
 * Checks if campaign is available for given platform
 */
export function isCampaignSupportedForPlatform(config: any, platform: Platform): boolean {
  const platforms = getCampaignPlatforms(config)
  return platforms.includes(platform)
}

/**
 * Resolves platform-specific guidelines, seamlessly falling back to root legacy fields
 */
export function getPlatformGuidelines(config: any, platform: Platform): PlatformGuidelines {
  const cfg = (config || {}) as CampaignMultiPlatformConfig

  if (platform === 'instagram') {
    const ig = cfg.instagram || {}
    return {
      mention: ig.mention || cfg.instagramMention || cfg.youtubeMentionChannel || '',
      cpm: ig.cpm !== undefined && ig.cpm !== '' ? ig.cpm : cfg.cpm || '',
      minViews: ig.minViews !== undefined ? Number(ig.minViews) : (cfg.minViews ? Number(cfg.minViews) : 0),
      onScreenTextGuide: ig.onScreenTextGuide || cfg.onScreenTextAiGuide || '',
      titleGuide: ig.titleGuide || ig.captionGuide || cfg.titlesAiGuide || '',
      captionGuide: ig.captionGuide || ig.titleGuide || cfg.titlesAiGuide || '',
      descriptionGuide: ig.descriptionGuide || cfg.descriptionsAiGuide || '',
      maxTitleCharacters: ig.maxTitleCharacters !== undefined ? Number(ig.maxTitleCharacters) : (cfg.maxTitleCharacters ? Number(cfg.maxTitleCharacters) : 100),
      onScreenMaxCharacters: ig.onScreenMaxCharacters !== undefined ? Number(ig.onScreenMaxCharacters) : (cfg.onScreenMaxCharacters ? Number(cfg.onScreenMaxCharacters) : 50),
      ftcDisclosure: ig.ftcDisclosure || cfg.ftcDisclosure || '',
      hashtagsGuide: ig.hashtagsGuide || '',
    }
  }

  // Default to YouTube
  const yt = cfg.youtube || {}
  return {
    mention: yt.mention || cfg.youtubeMentionChannel || '',
    cpm: yt.cpm !== undefined && yt.cpm !== '' ? yt.cpm : cfg.cpm || '',
    minViews: yt.minViews !== undefined ? Number(yt.minViews) : (cfg.minViews ? Number(cfg.minViews) : 0),
    onScreenTextGuide: yt.onScreenTextGuide || cfg.onScreenTextAiGuide || '',
    titleGuide: yt.titleGuide || cfg.titlesAiGuide || '',
    captionGuide: yt.captionGuide || yt.titleGuide || cfg.titlesAiGuide || '',
    descriptionGuide: yt.descriptionGuide || cfg.descriptionsAiGuide || '',
    maxTitleCharacters: yt.maxTitleCharacters !== undefined ? Number(yt.maxTitleCharacters) : (cfg.maxTitleCharacters ? Number(cfg.maxTitleCharacters) : 100),
    onScreenMaxCharacters: yt.onScreenMaxCharacters !== undefined ? Number(yt.onScreenMaxCharacters) : (cfg.onScreenMaxCharacters ? Number(cfg.onScreenMaxCharacters) : 50),
    ftcDisclosure: yt.ftcDisclosure || cfg.ftcDisclosure || '',
    hashtagsGuide: yt.hashtagsGuide || '',
  }
}

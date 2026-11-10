'use client'

import { useState } from 'react'
import {
  Heart,
  MessageCircle,
  Bookmark,
  Sparkles,
  Film,
  ZoomIn,
  Image as ImageIcon,
} from 'lucide-react'

export interface CampaignPreviewMockupProps {
  formData: {
    name?: string
    shortDuration?: number | string
    hookDuration?: number | string
    punchZoom?: number | string
    videoAspectRatio?: '9:16' | '4:3' | '1:1' | '16:9' | string
    frameBackgroundColor?: string
    tightenSilence?: boolean
    audioNotes?: string
    logoOverlayUrl?: string
    logoStyle?: string
    overlayPosition?: string
    overlayWidthPercent?: number | string
    overlayHeightPercent?: number | string
    onScreenTextPool?: string
    onScreenPositionHeightPercent?: number | string
    onScreenTextColor?: string
    onScreenBackground?: string
    onScreenFontName?: string
    onScreenStyledWordCount?: number | string
    onScreenStyledWordsColor?: string
    enableSubtitles?: string
    subtitlesPlacementHeightPercent?: number | string
    subtitleFonts?: string
    subtitleColors?: string
    outlineColors?: string
    speakingWordHighlight?: string
    subtitleTextCases?: string[]
    useSameFontForBannersAndSubs?: boolean
    useSameForSpeakingWordHighlight?: boolean
  }
}

// Convert background strings like 'red@0.8', 'black@0.5', '#000000' to CSS background
function parseBgColor(bgStr?: string): string {
  if (!bgStr) return 'rgba(0, 0, 0, 0.7)'
  const str = bgStr.trim().toLowerCase()

  if (str.includes('@')) {
    const [color, alphaStr] = str.split('@')
    const alpha = parseFloat(alphaStr) || 0.8
    if (color === 'red') return `rgba(220, 38, 38, ${alpha})`
    if (color === 'black') return `rgba(0, 0, 0, ${alpha})`
    if (color === 'blue') return `rgba(37, 99, 235, ${alpha})`
    if (color === 'green') return `rgba(22, 163, 74, ${alpha})`
    if (color === 'purple') return `rgba(147, 51, 234, ${alpha})`
    if (color === 'yellow') return `rgba(234, 179, 8, ${alpha})`
    if (color === 'white') return `rgba(255, 255, 255, ${alpha})`
    return `rgba(0, 0, 0, ${alpha})`
  }

  if (str === 'red') return 'rgba(220, 38, 38, 0.9)'
  if (str === 'black') return 'rgba(0, 0, 0, 0.9)'
  if (str === 'blue') return 'rgba(37, 99, 235, 0.9)'
  if (str === 'green') return 'rgba(22, 163, 74, 0.9)'
  if (str === 'purple') return 'rgba(147, 51, 234, 0.9)'
  if (str === 'yellow') return 'rgba(234, 179, 8, 0.9)'
  if (str === 'white') return 'rgba(255, 255, 255, 0.9)'
  if (str.startsWith('#')) return str

  return 'rgba(0, 0, 0, 0.7)'
}

// Map color names to CSS colors
function parseTextColor(cStr?: string): string {
  if (!cStr) return '#ffffff'
  const c = cStr.trim().toLowerCase()
  if (c === 'yellow') return '#facc15'
  if (c === 'red') return '#ef4444'
  if (c === 'green') return '#22c55e'
  if (c === 'cyan' || c === 'sky') return '#38bdf8'
  if (c === 'white') return '#ffffff'
  if (c === 'black') return '#000000'
  if (c.startsWith('#')) return c
  return '#ffffff'
}

// Render words with styled word highlights
function renderStyledWords(
  text: string,
  baseColor: string,
  highlightColor: string,
  styledCount: number
) {
  if (!text) return null
  const words = text.split(/\s+/)
  if (words.length === 0) return null
  if (!styledCount || styledCount <= 0) {
    return <span style={{ color: baseColor }}>{text}</span>
  }

  // Highlight the last N words (or first N words)
  const highlightStart = Math.max(0, words.length - styledCount)

  return (
    <>
      {words.map((word, idx) => {
        const isHighlight = idx >= highlightStart
        return (
          <span
            key={idx}
            style={{
              color: isHighlight ? highlightColor : baseColor,
            }}
          >
            {word}{' '}
          </span>
        )
      })}
    </>
  )
}

export function CampaignPreviewMockup({ formData }: CampaignPreviewMockupProps) {
  const [showRail, setShowRail] = useState(true)

  const shortDur = Number(formData.shortDuration) || 45
  const hookDur = Number(formData.hookDuration) || 3.5
  const zoom = Number(formData.punchZoom) || 1.2
  const aspectRatio = formData.videoAspectRatio || '9:16'
  const frameBg = formData.frameBackgroundColor || '#000000'

  // On-screen text sample
  const onScreenText =
    (formData.onScreenTextPool && formData.onScreenTextPool.split('\n')[0].trim()) ||
    'WAIT UNTIL THE END!'
  const onScreenPos = Number(formData.onScreenPositionHeightPercent) || 27
  const onScreenColor = parseTextColor(formData.onScreenTextColor || 'white')
  const onScreenBg = parseBgColor(formData.onScreenBackground || 'black@0.5')
  const onScreenStyledColor = parseTextColor(formData.onScreenStyledWordsColor || 'yellow')
  const onScreenStyledCount = Number(formData.onScreenStyledWordCount) || 0

  // Subtitles
  const subsEnabled = formData.enableSubtitles !== 'Disabled (Fallback to AI Captions)'
  const subsPos = Number(formData.subtitlesPlacementHeightPercent) || 80
  const subColor = parseTextColor(formData.subtitleColors || 'white')
  const resolvedSubFont = (formData.useSameFontForBannersAndSubs ? formData.onScreenFontName : formData.subtitleFonts) || 'inherit'
  const resolvedHighlight = parseTextColor((formData.useSameForSpeakingWordHighlight ? formData.onScreenStyledWordsColor : formData.speakingWordHighlight) || 'yellow')

  // Text Case handling for preview
  const textCaseList = Array.isArray(formData.subtitleTextCases)
    ? formData.subtitleTextCases
    : [formData.subtitleTextCases || 'Normal Text']
  const isNormal = textCaseList.some(
    (c) => String(c).toLowerCase().includes('normal') || String(c).toLowerCase().includes('orig')
  )
  const isLower = !isNormal && textCaseList.some((c) => String(c).toLowerCase().includes('lower'))
  const isUpper = !isNormal && !isLower && textCaseList.some((c) => String(c).toLowerCase().includes('upper'))

  const sampleLead = isUpper ? 'THIS IS THE' : isLower ? 'this is the' : 'This is the'
  const sampleHighlight = isUpper ? 'VIRAL' : isLower ? 'viral' : 'viral'
  const sampleTrail = isUpper ? 'MOMENT' : isLower ? 'moment' : 'moment'
  const textTransformStyle: React.CSSProperties['textTransform'] = isUpper ? 'uppercase' : isLower ? 'lowercase' : 'none'

  // Logo position calculation
  const getLogoStyle = () => {
    const pos = (formData.overlayPosition || 'Bottom Center').toLowerCase()
    const width = Math.min(Math.max(Number(formData.overlayWidthPercent) || 60, 10), 100)
    const heightPos = Math.min(Math.max(Number(formData.overlayHeightPercent) || 50, 0), 100)

    const base: React.CSSProperties = {
      position: 'absolute',
      width: `${Math.round(width * 0.45)}%`,
      zIndex: 25,
      transition: 'all 0.2s ease',
    }

    if (pos.includes('top')) {
      base.top = '10%'
    } else if (pos.includes('bottom')) {
      base.bottom = `${Math.max(6, 100 - heightPos)}%`
    } else {
      base.top = `${heightPos}%`
      base.transform = 'translateY(-50%)'
    }

    if (pos.includes('left')) {
      base.left = '6%'
    } else if (pos.includes('right')) {
      base.right = '6%'
    } else {
      base.left = '50%'
      base.transform = base.transform ? `${base.transform} translateX(-50%)` : 'translateX(-50%)'
    }

    return base
  }

  return (
    <div className="flex flex-col items-center select-none font-sans">
      {/* Header Bar */}
      <div className="w-full flex items-center justify-between px-3 py-2 mb-2 bg-muted/60 border border-border rounded-xl text-xs text-muted-foreground font-medium">
        <span className="flex items-center gap-1.5 font-bold text-foreground">
          <Film size={14} className="text-primary" />
          <span>Continuous 9:16 Canvas ({aspectRatio})</span>
        </span>
        <button
          type="button"
          onClick={() => setShowRail(!showRail)}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
            showRail
              ? 'bg-primary/20 text-primary border border-primary/30'
              : 'hover:bg-muted text-muted-foreground'
          }`}
        >
          {showRail ? 'Shorts UI: ON' : 'Shorts UI: OFF'}
        </button>
      </div>

      {/* ── PHONE FRAME (9:16 Aspect Ratio) ── */}
      <div className="w-full max-w-[310px] aspect-[9/16] bg-neutral-950 border-[5px] border-neutral-800 rounded-[42px] p-2.5 shadow-2xl relative flex flex-col justify-between overflow-hidden">
        {/* Dynamic Island / Notch */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-20 h-4 bg-black rounded-full z-40 flex items-center justify-end px-2">
          <div className="w-2 h-2 rounded-full bg-neutral-800" />
        </div>

        {/* Screen Glass Canvas with User Frame Background Color */}
        <div
          className="relative w-full h-full rounded-[30px] overflow-hidden border border-white/5 flex flex-col justify-between"
          style={{ backgroundColor: frameBg }}
        >
          {/* VIDEO FRAME INSIDE 9:16 CANVAS */}
          {aspectRatio === '9:16' ? (
            /* Full-frame 9:16 */
            <div className="absolute inset-0 w-full h-full bg-gradient-to-b from-slate-900 via-neutral-900 to-slate-950 flex flex-col justify-between p-4">
              <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px]" />
            </div>
          ) : (
            /* Boxed aspect ratio (4:3, 1:1, 16:9) centered vertically */
            <div className="w-full my-auto px-1">
              <div
                className={`w-full relative rounded-lg overflow-hidden border border-white/10 shadow-2xl bg-gradient-to-b from-slate-900 via-neutral-900 to-slate-950 flex items-center justify-center ${
                  aspectRatio === '4:3'
                    ? 'aspect-[4/3]'
                    : aspectRatio === '1:1'
                    ? 'aspect-square'
                    : 'aspect-[16/9]'
                }`}
              >
                <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:14px_14px]" />
                <div className="text-center p-2 z-10">
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-black/60 border border-white/15 text-[9px] font-mono font-bold text-white/90">
                    <Film size={10} className="text-primary" />
                    <span>Video Frame ({aspectRatio})</span>
                  </div>
                  <p className="text-[8px] text-white/50 mt-1">
                    Aspect ratio preserved without distortion
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Top Status Badges */}
          <div className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between pt-4 pointer-events-none">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/75 border border-emerald-500/30 backdrop-blur-md">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold tracking-wide text-white/90 uppercase">
                {aspectRatio} Canvas
              </span>
            </div>

            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/75 border border-primary/30 backdrop-blur-md text-[9px] font-mono font-semibold text-primary">
              <ZoomIn size={10} />
              <span>{zoom}x Zoom</span>
            </div>
          </div>

          {/* ON-SCREEN TEXT (HOOK BANNER) */}
          <div
            className="absolute left-3 right-3 z-30 flex justify-center pointer-events-none -translate-y-1/2"
            style={{ top: `${onScreenPos}%` }}
          >
            <div
              className="px-3 py-1.5 rounded-lg border border-white/20 shadow-xl max-w-[92%] text-center backdrop-blur-xs"
              style={{
                backgroundColor: onScreenBg,
                fontFamily: formData.onScreenFontName || 'inherit',
              }}
            >
              <p className="text-[12px] font-black tracking-wide leading-tight drop-shadow-md text-center whitespace-pre-wrap break-words">
                {renderStyledWords(
                  onScreenText,
                  onScreenColor,
                  onScreenStyledColor,
                  onScreenStyledCount
                )}
              </p>
            </div>
          </div>

          {/* LOGO OVERLAY */}
          {formData.logoOverlayUrl ? (
            <div style={getLogoStyle()}>
              <div className={`relative group flex items-center justify-center ${
                formData.logoStyle === 'white_card'
                  ? 'bg-white px-2.5 py-1.5 rounded-lg shadow-xl'
                  : formData.logoStyle === 'dark_card'
                  ? 'bg-black/85 px-2.5 py-1.5 rounded-lg border border-white/20 shadow-xl'
                  : ''
              }`}>
                <img
                  src={formData.logoOverlayUrl}
                  alt="Logo Overlay"
                  style={formData.logoStyle === 'invert' ? { filter: 'invert(1) brightness(2)' } : undefined}
                  className="w-full h-auto max-h-12 object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
                  onError={(e) => {
                    // Fallback to stylized logo badge if external image fails to load in preview
                    const target = e.currentTarget as HTMLElement
                    target.style.display = 'none'
                    const fallback = target.nextElementSibling as HTMLElement
                    if (fallback) fallback.style.display = 'flex'
                  }}
                />
                <div className="hidden px-2 py-1 bg-black/80 rounded border border-white/20 items-center gap-1 text-[9px] font-bold text-white shadow-lg">
                  <ImageIcon size={10} className="text-primary" />
                  <span className="truncate">LOGO</span>
                </div>
              </div>
            </div>
          ) : null}

          {/* SUBTITLES / CAPTIONS */}
          {subsEnabled ? (
            <div
              className="absolute left-3 right-3 z-30 flex justify-center pointer-events-none -translate-y-1/2"
              style={{ top: `${subsPos}%` }}
            >
              <div className="text-center px-2 py-1 bg-black/80 rounded-md border border-white/10 shadow-lg backdrop-blur-xs">
                <p
                  className="text-[11px] font-extrabold tracking-wide leading-tight drop-shadow"
                  style={{
                    color: subColor,
                    fontFamily: resolvedSubFont,
                    textTransform: textTransformStyle,
                  }}
                >
                  {sampleLead}{' '}
                  <span style={{ color: resolvedHighlight }} className="underline decoration-2">
                    {sampleHighlight}
                  </span>{' '}
                  {sampleTrail}
                </p>
              </div>
            </div>
          ) : (
            /* Clean Keyword Captions Default Simulation */
            <div className="absolute left-3 right-3 bottom-14 z-30 flex justify-center pointer-events-none">
              <div className="text-center py-1 px-2.5 bg-black/80 rounded-md border border-white/10 shadow-lg backdrop-blur-xs">
                <p className="text-[11px] font-black tracking-wide text-white leading-tight">
                  CLEAN KEYWORD <span className="text-amber-400">PUNCH</span>
                </p>
                <span className="text-[7px] font-mono text-white/50 block mt-0.5">
                  AI Keyword Highlights
                </span>
              </div>
            </div>
          )}

          {/* Bottom Campaign Tag */}
          <div className="absolute bottom-3 left-4 right-4 z-30 flex items-center justify-between text-[9px] text-white/60 font-mono pointer-events-none">
            <span className="truncate max-w-[150px]">{formData.name || 'Shorts Campaign'}</span>
            <span>~{shortDur}s</span>
          </div>

          {/* Simulated YouTube Shorts Right Action Rail */}
          {showRail && (
            <div className="absolute right-2 bottom-16 flex flex-col items-center gap-3 z-30 pointer-events-none">
              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-amber-500 to-primary p-0.5 shadow-md">
                <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-[8px] font-bold text-white">
                  CH
                </div>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center text-white/90">
                  <Heart size={12} fill="white" />
                </div>
                <span className="text-[8px] font-bold text-white drop-shadow">52K</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center text-white/90">
                  <MessageCircle size={12} fill="white" />
                </div>
                <span className="text-[8px] font-bold text-white drop-shadow">1.2K</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center text-white/90">
                  <Bookmark size={12} fill="white" />
                </div>
                <span className="text-[8px] font-bold text-white drop-shadow">4.8K</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

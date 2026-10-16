'use client'

import { useState } from 'react'
import {
  Heart,
  MessageCircle,
  Bookmark,
  Share2,
  Music2,
  Image as ImageIcon,
  Sparkles,
  Eye,
  Sliders,
  Layers,
} from 'lucide-react'

interface BannerItem {
  text: string
  font: string
  textColor: string
  positionHeightPercent: number
  fontSizePx: number
  background: string
  styledWordCount: number
  styledWordsColor: string
}

interface CampaignPreviewMockupProps {
  formData: {
    name?: string
    logoOverlayUrl?: string
    overlayPosition?: string
    overlayWidthPercent?: number
    overlayHeightPercent?: number
    numBottomBanners?: number
    banners?: BannerItem[]
    onScreenTextPool?: string
    onScreenPositionHeightPercent?: number
    onScreenTextColor?: string
    onScreenBackground?: string
    onScreenFontName?: string
    onScreenStyledWordCount?: number
    onScreenStyledWordsColor?: string
    enableSubtitles?: string
    subtitlesPlacementHeightPercent?: number
    subtitleFonts?: string
    subtitleColors?: string
    outlineColors?: string
    speakingWordHighlight?: string
    subtitleTextCases?: string[]
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
  const [showRuler, setShowRuler] = useState(true)
  const [showRail, setShowRail] = useState(true)

  // Logo position calculation
  const getLogoStyle = () => {
    const pos = (formData.overlayPosition || 'Bottom Center').toLowerCase()
    const width = Math.min(Math.max(formData.overlayWidthPercent || 40, 15), 80)
    const heightPercent = formData.overlayHeightPercent

    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      width: `${width}%`,
      zIndex: 20,
    }

    // Determine horizontal position
    let horizontalStyle: React.CSSProperties = { left: '50%', transform: 'translateX(-50%)' }
    if (pos.includes('left')) {
      horizontalStyle = { left: '4%' }
    } else if (pos.includes('right')) {
      horizontalStyle = { right: showRail ? '18%' : '4%' }
    } else if (pos.includes('center')) {
      horizontalStyle = { left: '50%', transform: 'translateX(-50%)' }
    }

    // If custom placement height % is provided, use exact percentage from top
    if (heightPercent !== undefined && !isNaN(heightPercent)) {
      const clamped = Math.max(0, Math.min(100, heightPercent))
      const combinedTransform = horizontalStyle.transform
        ? `${horizontalStyle.transform} translateY(-50%)`
        : 'translateY(-50%)'
      return {
        ...baseStyle,
        ...horizontalStyle,
        top: `${clamped}%`,
        transform: combinedTransform,
      }
    }

    if (pos.includes('top')) {
      return { ...baseStyle, ...horizontalStyle, top: '7%' }
    }
    if (pos.includes('bottom')) {
      return { ...baseStyle, ...horizontalStyle, bottom: '15%' }
    }
    return { ...baseStyle, ...horizontalStyle, top: '50%', transform: 'translate(-50%, -50%)' }
  }

  // On-screen text sample
  const onScreenLines = (formData.onScreenTextPool || '').split('\n').filter((l) => l.trim())
  const sampleOnScreen =
    onScreenLines[0] || 'HOW TO SCALE TO $10K/MO AS A CREATOR IN 2026'

  const onScreenHeight = formData.onScreenPositionHeightPercent ?? 27
  const onScreenBg = parseBgColor(formData.onScreenBackground)
  const onScreenTextC = parseTextColor(formData.onScreenTextColor)
  const onScreenHighlightC = parseTextColor(formData.onScreenStyledWordsColor)
  const onScreenCount = formData.onScreenStyledWordCount || 0

  // Subtitles
  const subtitlesHeight = formData.subtitlesPlacementHeightPercent ?? 80
  const subtitlesEnabled =
    !formData.enableSubtitles ||
    !formData.enableSubtitles.toLowerCase().includes('disabled')
  const subtitleColor = parseTextColor(formData.subtitleColors)
  const speakingHighlight = parseTextColor(formData.speakingWordHighlight)

  // Banners
  const activeBannersCount = Math.min(
    Math.max(formData.numBottomBanners ?? 1, 0),
    5
  )
  const banners = (formData.banners || []).slice(0, activeBannersCount)

  return (
    <div className="flex flex-col items-center select-none">
      {/* Controls Bar */}
      <div className="w-full flex items-center justify-between px-2 py-2 mb-2 bg-muted/60 border border-border rounded-xl text-[11px] text-muted-foreground font-medium">
        <span className="flex items-center gap-1.5 font-bold text-foreground">
          <Eye size={13} className="text-purple-500" />
          <span>Live 9:16 Visual Preview</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRuler(!showRuler)}
            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
              showRuler
                ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                : 'hover:bg-muted text-muted-foreground'
            }`}
          >
            {showRuler ? 'Ruler: ON' : 'Ruler: OFF'}
          </button>
          <button
            type="button"
            onClick={() => setShowRail(!showRail)}
            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
              showRail
                ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                : 'hover:bg-muted text-muted-foreground'
            }`}
          >
            {showRail ? 'Shorts UI: ON' : 'Shorts UI: OFF'}
          </button>
        </div>
      </div>

      {/* ── PHONE FRAME (9:16 Aspect Ratio) ── */}
      <div className="w-full max-w-[310px] aspect-[9/16] bg-neutral-900 border-[5px] border-neutral-700/80 rounded-[42px] p-2.5 shadow-2xl relative flex flex-col justify-between overflow-hidden">
        {/* Dynamic Island / Notch */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-20 h-4 bg-black rounded-full z-40 flex items-center justify-end px-2">
          <div className="w-2 h-2 rounded-full bg-neutral-800" />
        </div>

        {/* Screen Glass Canvas */}
        <div className="relative w-full h-full rounded-[30px] overflow-hidden bg-gradient-to-b from-slate-900 via-neutral-950 to-black border border-white/5">
          {/* Simulated Video Canvas Backdrop */}
          <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px]" />

          {/* Guidelines / Ruler Overlay */}
          {showRuler && (
            <div className="absolute inset-0 pointer-events-none z-10">
              {[20, 27, 40, 60, 75, 80, 85, 90].map((pct) => (
                <div
                  key={pct}
                  style={{ top: `${pct}%` }}
                  className="absolute w-full border-t border-dashed border-cyan-400/20 flex justify-end pr-1.5"
                >
                  <span className="text-[8px] font-mono text-cyan-400/60 -mt-2">
                    {pct}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── 1. LOGO OVERLAY ── */}
          {(formData.logoOverlayUrl || formData.overlayPosition) && (
            <div style={getLogoStyle()} className="group transition-all">
              {formData.logoOverlayUrl ? (
                <img
                  src={formData.logoOverlayUrl}
                  alt="Logo"
                  className="max-h-12 w-auto object-contain mx-auto filter drop-shadow-md"
                />
              ) : (
                <div className="py-1 px-3 bg-black/70 backdrop-blur-xs border border-white/20 rounded-lg flex items-center justify-center gap-1.5 text-white shadow-lg">
                  <ImageIcon size={11} className="text-purple-400 shrink-0" />
                  <span className="text-[10px] font-bold tracking-wider uppercase">
                    LOGO ({formData.overlayWidthPercent || 40}%)
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── 2. ON-SCREEN TEXT OVERLAY ── */}
          <div
            style={{
              position: 'absolute',
              top: `${onScreenHeight}%`,
              left: '50%',
              transform: 'translateX(-50%)',
              width: showRail ? '80%' : '90%',
              zIndex: 22,
            }}
            className="transition-all"
          >
            <div
              style={{
                backgroundColor: onScreenBg,
              }}
              className="py-1.5 px-2.5 rounded-lg border border-white/10 text-center shadow-xl backdrop-blur-[2px]"
            >
              <p
                style={{
                  fontFamily: formData.onScreenFontName || 'sans-serif',
                }}
                className="text-[11px] font-black leading-tight tracking-wide uppercase drop-shadow-[0_1.5px_1.5px_rgba(0,0,0,0.9)]"
              >
                {renderStyledWords(
                  sampleOnScreen,
                  onScreenTextC,
                  onScreenHighlightC,
                  onScreenCount
                )}
              </p>
              <div className="text-[7.5px] font-mono text-white/50 mt-0.5">
                On-Screen Text @ {onScreenHeight}%
              </div>
            </div>
          </div>

          {/* ── 3. SUBTITLES OVERLAY ── */}
          {subtitlesEnabled && (
            <div
              style={{
                position: 'absolute',
                top: `${subtitlesHeight}%`,
                left: '50%',
                transform: 'translateX(-50%)',
                width: showRail ? '78%' : '88%',
                zIndex: 23,
              }}
              className="transition-all text-center"
            >
              <div className="inline-block py-1 px-2.5 bg-black/60 rounded-md backdrop-blur-xs border border-white/10">
                <p
                  style={{
                    fontFamily: formData.subtitleFonts || 'sans-serif',
                  }}
                  className="text-[11.5px] font-black leading-tight tracking-wider uppercase drop-shadow-[0_2px_2px_rgba(0,0,0,1)]"
                >
                  <span style={{ color: subtitleColor }}>THIS IS THE </span>
                  <span
                    style={{ color: speakingHighlight }}
                    className="underline decoration-2"
                  >
                    EXACT
                  </span>
                  <span style={{ color: subtitleColor }}> FORMULA</span>
                </p>
                <div className="text-[7px] font-mono text-cyan-300/60 mt-0.5">
                  Subtitles @ {subtitlesHeight}%
                </div>
              </div>
            </div>
          )}

          {/* ── 4. BOTTOM BANNERS (0 to 5) ── */}
          {banners.map((banner, idx) => {
            const bPos = banner.positionHeightPercent || 85 + idx * 5
            const bBg = parseBgColor(banner.background)
            const bTextC = parseTextColor(banner.textColor)
            const bHighlightC = parseTextColor(banner.styledWordsColor)
            const bCount = banner.styledWordCount || 0
            const bText =
              banner.text || `BANNER #${idx + 1}: TAP LINK IN BIO FOR ACCESS`

            return (
              <div
                key={idx}
                style={{
                  position: 'absolute',
                  top: `${bPos}%`,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: showRail ? '82%' : '92%',
                  zIndex: 24 + idx,
                }}
                className="transition-all"
              >
                <div
                  style={{
                    backgroundColor: bBg,
                  }}
                  className="py-1 px-2 rounded-md text-center shadow-lg border border-white/10"
                >
                  <p
                    style={{
                      fontFamily: banner.font || 'sans-serif',
                    }}
                    className="text-[10px] font-black leading-tight tracking-wide uppercase drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                  >
                    {renderStyledWords(bText, bTextC, bHighlightC, bCount)}
                  </p>
                  <div className="text-[6.5px] font-mono text-white/50 mt-0.5">
                    Banner #{idx + 1} @ {bPos}%
                  </div>
                </div>
              </div>
            );
          })}

          {/* ── 5. SIMULATED YOUTUBE SHORTS / TIKTOK RIGHT RAIL ── */}
          {showRail && (
            <div className="absolute right-2 bottom-12 flex flex-col items-center gap-3 z-30 pointer-events-none">
              {/* Creator Avatar */}
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 p-0.5 shadow-md">
                <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-[9px] font-bold text-white">
                  CH
                </div>
              </div>
              {/* Like */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-6 h-6 rounded-full bg-black/40 backdrop-blur-xs flex items-center justify-center text-white/90">
                  <Heart size={13} fill="white" />
                </div>
                <span className="text-[8px] font-bold text-white drop-shadow">
                  42.8K
                </span>
              </div>
              {/* Comment */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-6 h-6 rounded-full bg-black/40 backdrop-blur-xs flex items-center justify-center text-white/90">
                  <MessageCircle size={13} fill="white" />
                </div>
                <span className="text-[8px] font-bold text-white drop-shadow">
                  892
                </span>
              </div>
              {/* Bookmark */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-6 h-6 rounded-full bg-black/40 backdrop-blur-xs flex items-center justify-center text-white/90">
                  <Bookmark size={13} fill="white" />
                </div>
                <span className="text-[8px] font-bold text-white drop-shadow">
                  3.4K
                </span>
              </div>
              {/* Share */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-6 h-6 rounded-full bg-black/40 backdrop-blur-xs flex items-center justify-center text-white/90">
                  <Share2 size={13} />
                </div>
                <span className="text-[8px] font-bold text-white drop-shadow">
                  Share
                </span>
              </div>
            </div>
          )}

          {/* Bottom Audio simulation */}
          <div className="absolute bottom-2 left-3 right-14 flex items-center gap-1.5 z-20 pointer-events-none">
            <Music2 size={9} className="text-white/70 animate-pulse" />
            <span className="text-[8px] font-medium text-white/70 truncate">
              Original Sound - @{formData.name ? formData.name.replace(/\s+/g, '').toLowerCase() : 'creatorhub'}
            </span>
          </div>

          {/* Home indicator bar */}
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-20 h-1 bg-white/40 rounded-full z-40" />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground mt-2 text-center max-w-[280px]">
        Real-time coordinates match what FFmpeg renders on 1080x1920 shorts.
      </p>
    </div>
  )
}

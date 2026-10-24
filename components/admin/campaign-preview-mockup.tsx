'use client'

import { useState } from 'react'
import {
  Heart,
  MessageCircle,
  Bookmark,
  Sparkles,
  Eye,
  Film,
  ZoomIn,
  Volume2,
} from 'lucide-react'

interface CampaignPreviewMockupProps {
  formData: {
    name?: string
    shortDuration?: number | string
    hookDuration?: number | string
    punchZoom?: number | string
    tightenSilence?: boolean
    audioNotes?: string
  }
}

export function CampaignPreviewMockup({ formData }: CampaignPreviewMockupProps) {
  const [showRail, setShowRail] = useState(true)

  const shortDur = Number(formData.shortDuration) || 45
  const hookDur = Number(formData.hookDuration) || 3.5
  const zoom = Number(formData.punchZoom) || 1.2

  return (
    <div className="flex flex-col items-center select-none font-sans">
      {/* Header Bar */}
      <div className="w-full flex items-center justify-between px-3 py-2 mb-2 bg-muted/60 border border-border rounded-xl text-xs text-muted-foreground font-medium">
        <span className="flex items-center gap-1.5 font-bold text-foreground">
          <Film size={14} className="text-primary" />
          <span>Story Re-Cut 9:16 Live Preview</span>
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

        {/* Screen Glass Canvas */}
        <div className="relative w-full h-full rounded-[30px] overflow-hidden bg-gradient-to-b from-slate-900 via-neutral-950 to-black border border-white/5 flex flex-col justify-between p-4">
          {/* Subtle Grid Backdrop */}
          <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px]" />

          {/* Top Status Badges */}
          <div className="relative z-30 flex items-center justify-between pt-6">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 border border-emerald-500/30 backdrop-blur-md">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold tracking-wide text-white/90 uppercase">
                Brand-Safe 9:16
              </span>
            </div>

            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/70 border border-primary/30 backdrop-blur-md text-[9px] font-mono font-semibold text-primary">
              <ZoomIn size={10} />
              <span>{zoom}x Zoom</span>
            </div>
          </div>

          {/* Center Graphic: Cold-Open Story Architecture */}
          <div className="relative z-20 my-auto text-center space-y-3 px-2">
            <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold uppercase tracking-wider">
              <Sparkles size={11} />
              <span>Cold-Open Payoff Reorder</span>
            </div>

            <div className="bg-black/60 border border-white/10 rounded-xl p-3 backdrop-blur-xs text-left space-y-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-semibold text-amber-400 flex items-center gap-1">
                  1. Hook (Payoff First)
                </span>
                <span className="font-mono text-white/60">0:00 - 0:0{Math.round(hookDur)}s</span>
              </div>
              <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-amber-400 h-full"
                  style={{ width: `${Math.min(30, (hookDur / shortDur) * 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] pt-1 border-t border-white/5">
                <span className="font-semibold text-white/80">2. Setup / Story</span>
                <span className="font-mono text-white/60">1.0x Normal</span>
              </div>

              <div className="flex items-center justify-between text-[10px] pt-1 border-t border-white/5">
                <span className="font-semibold text-white/80">3. Payoff in Context</span>
                <span className="font-mono text-white/60">1.12x Climax</span>
              </div>
            </div>

            <p className="text-[10px] text-white/60 italic leading-snug">
              Uses ONLY brand source footage. Zero memes, zero stickers, zero mirror blur.
            </p>
          </div>

          {/* Bottom Captions Simulation */}
          <div className="relative z-30 space-y-2 pb-2">
            <div className="text-center">
              <div className="inline-block py-1.5 px-3 bg-black/75 rounded-lg border border-white/15 backdrop-blur-xs shadow-lg">
                <p className="text-[12px] font-black tracking-wide text-white leading-tight">
                  THIS IS THE <span className="text-amber-400">EXACT</span> FORMULA
                </p>
                <span className="text-[7.5px] font-mono text-white/50 block mt-0.5">
                  Clean Keyword Highlight Captions
                </span>
              </div>
            </div>

            {/* Campaign Name Tag */}
            <div className="flex items-center justify-between text-[9px] text-white/50 px-1 font-mono">
              <span className="truncate max-w-[150px]">{formData.name || 'Shorts Campaign'}</span>
              <span>~{shortDur}s</span>
            </div>
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

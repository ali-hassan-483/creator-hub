'use client'

import { useState, useEffect } from 'react'
import {
  Sparkles,
  Download,
  Play,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  FileText,
  Film,
  Sliders,
  ExternalLink,
} from 'lucide-react'

interface CampaignOption {
  id: string
  name: string
  status: string
  description?: string | null
  config?: any
}

interface SandboxResult {
  clipId: string
  campaignId: string
  title: string
  description: string
  onScreenText: string
  hashtags: string[]
  videoUrl: string
  duration: number
}

interface AdminSandboxTestClientProps {
  initialCampaigns?: CampaignOption[]
}

export function AdminSandboxTestClient({ initialCampaigns = [] }: AdminSandboxTestClientProps) {
  const [campaigns, setCampaigns] = useState<CampaignOption[]>(initialCampaigns)
  const [selectedCampaignId, setSelectedCampaignId] = useState(initialCampaigns[0]?.id || '')
  const [loadingCampaigns, setLoadingCampaigns] = useState(initialCampaigns.length === 0)

  // Rendering state
  const [rendering, setRendering] = useState(false)
  const [renderProgress, setRenderProgress] = useState('')
  const [result, setResult] = useState<SandboxResult | null>(null)
  const [error, setError] = useState('')
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    async function loadCampaigns() {
      try {
        const res = await fetch('/api/admin/campaigns')
        if (res.ok) {
          const data = await res.json()
          const list = Array.isArray(data) ? data : (data.campaigns || [])
          setCampaigns(list)
          if (!selectedCampaignId && list.length > 0) {
            setSelectedCampaignId(list[0].id)
          }
        }
      } catch (e: any) {
        console.error(e)
      } finally {
        setLoadingCampaigns(false)
      }
    }
    loadCampaigns()
  }, [])

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId)
  const cfg = selectedCampaign?.config || {}

  const handleGenerateSandboxClip = async () => {
    if (!selectedCampaignId) {
      setError('Please select a campaign configuration first.')
      return
    }

    setRendering(true)
    setError('')
    setResult(null)
    setRenderProgress('🚀 Starting sandbox render job...')

    try {
      const res = await fetch('/api/user/sandbox-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
      })

      const rawText = await res.text()
      let data: any
      try {
        data = JSON.parse(rawText)
      } catch {
        const cleanMsg = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
        throw new Error(cleanMsg || `Server error (${res.status})`)
      }

      if (!res.ok) throw new Error(data.error || 'Failed to render sandbox clip.')

      const jobId = data.jobId
      if (!jobId) {
        if (data.videoUrl) {
          setResult(data)
        }
        setRendering(false)
        return
      }

      setRenderProgress(data.progress || '🎬 Rendering video clip...')

      // Poll job status every 2 seconds
      const pollInterval = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/user/sandbox-render?jobId=${jobId}`)
          if (!pollRes.ok) return

          const pollData = await pollRes.json()
          if (pollData.progress) {
            setRenderProgress(pollData.progress)
          }

          if (pollData.status === 'completed' && pollData.result) {
            clearInterval(pollInterval)
            setResult(pollData.result)
            setRendering(false)
          } else if (pollData.status === 'error') {
            clearInterval(pollInterval)
            setError(pollData.error || 'Sandbox rendering failed.')
            setRendering(false)
          }
        } catch {}
      }, 2000)

    } catch (err: any) {
      setError(err.message)
      setRendering(false)
    }
  }

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-7 font-sans">
      {/* Title */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
            Admin Sandbox Style Test
          </h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            Admin Preview Studio
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Select any campaign to compile a test 9:16 vertical video clip using the campaign’s exact banner positions, subtitles, logo overlay, and AI metadata without publishing to YouTube.
        </p>
      </div>

      {/* ── CARD: Test rendering sandbox ── */}
      <div className="bg-card border border-border rounded-3xl p-6 sm:p-8 shadow-sm space-y-5">
        <div>
          <h2 className="text-base font-bold text-foreground">
            Test Rendering & Styling Engine
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Runs FFmpeg locally on the VPS with your bottom banners, on-screen text, and subtitles. Uses AI (Gemini / OpenRouter fallback) to extract viral timestamps and generate titles.
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2 bg-destructive/10 text-destructive border border-destructive/30">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Select Campaign Settings */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-foreground block">
            Select Campaign Configuration
          </label>
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            disabled={rendering}
            className="w-full rounded-2xl px-4 py-3 text-xs bg-background border border-input text-foreground cursor-pointer font-medium focus:outline-hidden focus:ring-2 focus:ring-ring"
          >
            <option value="">
              {loadingCampaigns ? 'Loading campaigns...' : '-- Select a Campaign --'}
            </option>
            {campaigns.map((camp) => (
              <option key={camp.id} value={camp.id}>
                {camp.name} ({camp.status.toUpperCase()})
              </option>
            ))}
          </select>
        </div>

        {/* Campaign styling overview pill when selected */}
        {selectedCampaign && (
          <div className="bg-muted/40 border border-border rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground text-[11px] block">Clipping Strategy</span>
              <span className="font-semibold text-foreground capitalize">
                {(cfg.clippingStrategies || ['multi_cut']).join(', ')}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground text-[11px] block">Subtitles</span>
              <span className="font-semibold text-foreground">
                {cfg.enableSubtitles || 'Enabled'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground text-[11px] block">Bottom Banners</span>
              <span className="font-semibold text-foreground">
                {cfg.numBottomBanners ?? (cfg.banners?.filter((b: any) => b.text)?.length || 0)} banner(s)
              </span>
            </div>
            <div>
              <span className="text-muted-foreground text-[11px] block">On-Screen Text</span>
              <span className="font-semibold text-foreground">
                {cfg.onScreenPositionHeightPercent ? `${cfg.onScreenPositionHeightPercent}% height` : 'Auto'}
              </span>
            </div>
          </div>
        )}

        {/* Generate Button */}
        <div>
          <button
            type="button"
            onClick={handleGenerateSandboxClip}
            disabled={rendering || !selectedCampaignId}
            className="w-full py-3.5 rounded-2xl text-xs font-bold tracking-wide flex items-center justify-center gap-2 bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 transition-colors shadow-sm"
          >
            {rendering ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>{renderProgress || 'Compiling clip with FFmpeg & Generating AI Metadata...'}</span>
              </>
            ) : (
              <>
                <Sparkles size={15} />
                <span>Generate Admin Sandbox Clip</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── PREVIEW RESULT CARD: Rendered Video + Title + Description + Download ── */}
      {result && (
        <div className="bg-card border border-border rounded-3xl p-6 sm:p-8 space-y-6 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-500" />
              <span>Sandbox Clip Ready ({result.duration}s)</span>
            </h3>
            <a
              href={result.videoUrl}
              download={`${result.clipId}.mp4`}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground flex items-center gap-1.5 hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Download size={13} />
              <span>Download MP4</span>
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            {/* Video Player (9:16 Vertical Preview) */}
            <div className="md:col-span-5 flex flex-col items-center">
              <div className="rounded-3xl p-2 w-full max-w-[270px] aspect-[9/16] bg-black flex items-center justify-center overflow-hidden border border-neutral-800 shadow-xl">
                <video
                  src={result.videoUrl}
                  controls
                  playsInline
                  className="w-full h-full object-cover rounded-2xl"
                />
              </div>
              <span className="text-[10px] text-muted-foreground mt-2 font-mono">
                1080x1920 (9:16 Vertical Short)
              </span>
            </div>

            {/* Metadata (Title + Description + On-Screen Text) */}
            <div className="md:col-span-7 space-y-4">
              {/* Title */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Generated Title:
                  </span>
                  <button
                    onClick={() => handleCopy(result.title, 'title')}
                    className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1 hover:underline"
                  >
                    {copiedField === 'title' ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedField === 'title' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="p-3 bg-muted/40 border border-border rounded-xl text-xs font-medium text-foreground">
                  {result.title}
                </div>
              </div>

              {/* On-Screen Text */}
              {result.onScreenText && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      On-Screen Text Hook:
                    </span>
                    <button
                      onClick={() => handleCopy(result.onScreenText, 'hook')}
                      className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1 hover:underline"
                    >
                      {copiedField === 'hook' ? <Check size={11} /> : <Copy size={11} />}
                      <span>{copiedField === 'hook' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="p-3 bg-muted/40 border border-border rounded-xl text-xs font-medium text-foreground">
                    {result.onScreenText}
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Generated Description:
                  </span>
                  <button
                    onClick={() => handleCopy(result.description, 'desc')}
                    className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1 hover:underline"
                  >
                    {copiedField === 'desc' ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedField === 'desc' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="p-3 bg-muted/40 border border-border rounded-xl text-xs text-foreground whitespace-pre-wrap max-h-40 overflow-y-auto font-sans leading-relaxed">
                  {result.description}
                </div>
              </div>

              {/* Hashtags */}
              {result.hashtags && result.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {result.hashtags.map((tag, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-primary/10 text-primary text-[11px] font-semibold rounded-lg"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import {
  Sparkles, Download, Play, RefreshCw, AlertCircle,
  CheckCircle2, Copy, Check, FileText, Film, Eye
} from 'lucide-react'

interface CampaignOption {
  id: string
  name: string
  description?: string | null
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

export default function SandboxTestClient() {
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)

  // Rendering state
  const [rendering, setRendering] = useState(false)
  const [result, setResult] = useState<SandboxResult | null>(null)
  const [error, setError] = useState('')
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    async function loadCampaigns() {
      try {
        const res = await fetch('/api/user/automation')
        if (res.ok) {
          const data = await res.json()
          setCampaigns(data.campaigns || [])
        }
      } catch (e: any) {
        console.error(e)
      } finally {
        setLoadingCampaigns(false)
      }
    }
    loadCampaigns()
  }, [])

  const handleGenerateSandboxClip = async () => {
    if (!selectedCampaignId) {
      setError('Please select a campaign configuration first.')
      return
    }

    setRendering(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch('/api/user/sandbox-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to render sandbox clip.')

      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
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
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#2b3345] dark:text-[#e2e8f0] tracking-tight">
          Sandbox Render Sandbox
        </h1>
      </div>

      {/* ── CARD: Test rendering sandbox (Exact User Screenshot Layout) ── */}
      <div className="neu-flat rounded-3xl p-6 sm:p-8 space-y-5">
        <div>
          <h2 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0]">
            Test rendering sandbox
          </h2>
          <p className="text-[11px] text-[#718096] dark:text-[#94a3b8] mt-0.5 leading-relaxed">
            Select a campaign configuration to test compile a short video locally. Sandbox runs download and FFmpeg clips locally without publishing.
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
          <label className="text-xs font-semibold text-[#495470] dark:text-[#cbd5e1] block">
            Select Campaign Settings
          </label>
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            disabled={rendering}
            className="neu-pressed w-full rounded-2xl px-4 py-3 text-xs text-foreground cursor-pointer font-medium focus:outline-hidden"
          >
            <option value="">-- Select a Campaign --</option>
            {campaigns.map((camp) => (
              <option key={camp.id} value={camp.id}>
                {camp.name}
              </option>
            ))}
          </select>
        </div>

        {/* Generate Button (Exact Purple Banner Style) */}
        <div>
          <button
            type="button"
            onClick={handleGenerateSandboxClip}
            disabled={rendering || !selectedCampaignId}
            className="neu-primary-button w-full py-3.5 rounded-2xl text-xs font-bold tracking-wide flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {rendering ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>Compiling clip with FFmpeg & Generating AI Metadata... (Please wait)</span>
              </>
            ) : (
              <>
                <Sparkles size={15} />
                <span>Generate Sandbox Clip</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── PREVIEW RESULT CARD: Rendered Video + Title + Description + Download ── */}
      {result && (
        <div className="neu-flat rounded-3xl p-6 sm:p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between border-b border-black/5 dark:border-white/5 pb-3">
            <h3 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0] flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-500" />
              <span>Sandbox Clip Ready ({result.duration}s)</span>
            </h3>
            <a
              href={result.videoUrl}
              download={`${result.clipId}.mp4`}
              className="neu-button px-4 py-1.5 rounded-xl text-xs font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1.5"
            >
              <Download size={13} />
              <span>Download MP4</span>
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            {/* Video Player (9:16 Vertical Preview) */}
            <div className="md:col-span-5 flex flex-col items-center">
              <div className="neu-pressed rounded-3xl p-2 w-full max-w-[270px] aspect-[9/16] bg-black flex items-center justify-center overflow-hidden">
                <video
                  src={result.videoUrl}
                  controls
                  playsInline
                  className="w-full h-full object-cover rounded-2xl"
                />
              </div>
              <span className="text-[10px] text-muted-foreground mt-2">
                1080x1920 (9:16 Vertical Short)
              </span>
            </div>

            {/* Metadata (Title + Description + On-Screen Text) */}
            <div className="md:col-span-7 space-y-4">
              {/* Title */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#6c7a9c] dark:text-[#94a3b8]">
                    Generated Title:
                  </span>
                  <button
                    onClick={() => handleCopy(result.title, 'title')}
                    className="text-[10px] text-purple-600 font-semibold flex items-center gap-1"
                  >
                    {copiedField === 'title' ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedField === 'title' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="neu-pressed rounded-xl p-3 text-xs font-bold text-[#2b3345] dark:text-[#f1f5f9]">
                  {result.title}
                </div>
              </div>

              {/* On-screen Text Hook */}
              {result.onScreenText && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#6c7a9c] dark:text-[#94a3b8]">
                      On-Screen Text Hook:
                    </span>
                    <button
                      onClick={() => handleCopy(result.onScreenText, 'hook')}
                      className="text-[10px] text-purple-600 font-semibold flex items-center gap-1"
                    >
                      {copiedField === 'hook' ? <Check size={11} /> : <Copy size={11} />}
                      <span>{copiedField === 'hook' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="neu-pressed rounded-xl p-2.5 text-xs font-mono text-purple-600 dark:text-purple-400">
                    &ldquo;{result.onScreenText}&rdquo;
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#6c7a9c] dark:text-[#94a3b8]">
                    Generated Description:
                  </span>
                  <button
                    onClick={() => handleCopy(result.description, 'desc')}
                    className="text-[10px] text-purple-600 font-semibold flex items-center gap-1"
                  >
                    {copiedField === 'desc' ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedField === 'desc' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="neu-pressed rounded-xl p-3 text-xs text-[#495470] dark:text-[#cbd5e1] whitespace-pre-line max-h-48 overflow-y-auto leading-relaxed">
                  {result.description}
                </div>
              </div>

              {/* Hashtags */}
              {result.hashtags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {result.hashtags.map((h, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[10px] font-mono"
                    >
                      #{h}
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

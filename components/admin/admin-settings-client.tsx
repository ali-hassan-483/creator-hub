'use client'

import { useState, useEffect } from 'react'
import {
  MessageSquare,
  Save,
  Send,
  CheckCircle2,
  AlertCircle,
  Shield,
  Bot,
  Sparkles,
  Zap,
  RefreshCw,
  Key,
} from 'lucide-react'

export function AdminSettingsClient() {
  // Discord settings
  const [webhookUrl, setWebhookUrl] = useState('')
  const [label, setLabel] = useState('Admin Alerts')
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)

  // AI & OpenRouter settings
  const [openRouterKey, setOpenRouterKey] = useState('')
  const [maskedKey, setMaskedKey] = useState('')
  const [geminiCount, setGeminiCount] = useState(0)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiTesting, setAiTesting] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<{
    text: string
    latency: number
    model: string
  } | null>(null)

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetchConfig()
    fetchAiConfig()
  }, [])

  async function fetchConfig() {
    try {
      const res = await fetch('/api/admin/discord-config')
      if (res.ok) {
        const data = await res.json()
        if (data.config) {
          setWebhookUrl(data.config.webhookUrl || '')
          setLabel(data.config.label || 'Admin Alerts')
          setIsActive(data.config.isActive ?? true)
        }
      }
    } catch (e) {}
  }

  async function fetchAiConfig() {
    try {
      const res = await fetch('/api/admin/ai-config')
      if (res.ok) {
        const data = await res.json()
        setOpenRouterKey(data.openRouterKey || '')
        setMaskedKey(data.maskedKey || '')
        setGeminiCount(data.geminiKeyCount || 0)
      }
    } catch (e) {}
  }

  async function handleSaveDiscord(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/discord-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl, label, isActive }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg({ type: 'success', text: 'Discord webhook saved successfully!' })
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to save webhook' })
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'Error saving' })
    } finally {
      setLoading(false)
    }
  }

  async function handleTestDiscord() {
    if (!webhookUrl) {
      setMsg({ type: 'error', text: 'Please enter a webhook URL first.' })
      return
    }
    setTesting(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/discord-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg({ type: 'success', text: 'Test alert sent! Check your Discord channel.' })
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to send test alert' })
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSaveAi(e: React.FormEvent) {
    e.preventDefault()
    setAiLoading(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openRouterKey }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg({ type: 'success', text: 'OpenRouter AI Fallback key saved successfully!' })
        fetchAiConfig()
      } else {
        setMsg({ type: 'error', text: data.error || 'Failed to save AI config' })
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'Error saving AI config' })
    } finally {
      setAiLoading(false)
    }
  }

  async function handleTestAi() {
    setAiTesting(true)
    setAiTestResult(null)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ai-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openRouterKey }),
      })
      const data = await res.json()
      if (res.ok) {
        setAiTestResult({
          text: data.response,
          latency: data.latencyMs,
          model: data.model,
        })
        setMsg({
          type: 'success',
          text: `OpenRouter AI Test Passed! Latency: ${data.latencyMs}ms (${data.model})`,
        })
      } else {
        setMsg({ type: 'error', text: data.error || 'AI test call failed' })
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'AI test failed' })
    } finally {
      setAiTesting(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      {msg && (
        <div
          className={`p-4 rounded-xl flex items-center gap-3 text-sm font-medium border ${
            msg.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
              : 'bg-destructive/10 text-destructive border-destructive/20'
          }`}
        >
          {msg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* ── CARD 1: OpenRouter AI Fallback & Gemini Engine ── */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
              <Sparkles size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">
                  AI Engine & Zero-Limit Fallback (OpenRouter)
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Active & Auto-Failover
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automatically powers campaign brief parsing, viral clip extraction, title generation, descriptions, and on-screen hooks. If users haven’t added Gemini keys or hit quotas, OpenRouter takes over seamlessly without limits.
              </p>
            </div>
          </div>
        </div>

        {/* Info pills */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="bg-muted/40 border border-border rounded-xl p-3">
            <p className="text-[11px] text-muted-foreground font-medium">Gemini Pool Keys</p>
            <p className="text-sm font-bold text-foreground mt-0.5">
              {geminiCount} active in DB/env
            </p>
          </div>
          <div className="bg-muted/40 border border-border rounded-xl p-3">
            <p className="text-[11px] text-muted-foreground font-medium">Fallback Provider</p>
            <p className="text-sm font-bold text-foreground mt-0.5">
              OpenRouter API (Unlimited)
            </p>
          </div>
          <div className="bg-muted/40 border border-border rounded-xl p-3">
            <p className="text-[11px] text-muted-foreground font-medium">Engine Models</p>
            <p className="text-sm font-bold text-foreground mt-0.5">
              Gemini 2.5 Flash / Flash Lite
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveAi} className="space-y-4 pt-2 border-t border-border">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
              <Key size={14} className="text-purple-500" />
              <span>OpenRouter API Key</span>
            </label>
            <input
              type="text"
              placeholder="sk-or-v1-..."
              value={openRouterKey}
              onChange={(e) => setOpenRouterKey(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Currently active: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{maskedKey}</code>. Default key provided with zero rate limit.
            </p>
          </div>

          {aiTestResult && (
            <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl space-y-1">
              <div className="flex items-center justify-between text-xs font-semibold text-purple-600 dark:text-purple-400">
                <span>Model: {aiTestResult.model}</span>
                <span>Latency: {aiTestResult.latency}ms</span>
              </div>
              <p className="text-xs text-foreground font-medium">
                "{aiTestResult.text}"
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={handleTestAi}
              disabled={aiTesting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-50"
            >
              {aiTesting ? (
                <RefreshCw size={14} className="animate-spin text-purple-500" />
              ) : (
                <Zap size={14} className="text-purple-500" />
              )}
              <span>{aiTesting ? 'Testing OpenRouter...' : 'Test AI Connection'}</span>
            </button>

            <button
              type="submit"
              disabled={aiLoading}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-purple-600 text-white rounded-xl text-xs font-semibold hover:bg-purple-700 transition-colors shadow-sm disabled:opacity-50"
            >
              <Save size={14} />
              <span>{aiLoading ? 'Saving...' : 'Save AI Config'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* ── CARD 2: Discord Notification Card ── */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#5865F2]/10 text-[#5865F2] flex items-center justify-center shrink-0">
            <MessageSquare size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Discord Automated Alerts</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Receive instant alerts for campaign source download failures, YouTube upload errors, and Whop submission events directly in your Discord server.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveDiscord} className="space-y-4 pt-2 border-t border-border">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Discord Webhook URL
            </label>
            <input
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              In Discord: Server Settings &gt; Integrations &gt; Webhooks &gt; New Webhook &gt; Copy Webhook URL.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Channel / Bot Label
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Admin Alerts"
                className="w-full px-3.5 py-2.5 bg-background border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex items-center gap-3 pt-6">
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-input text-primary focus:ring-ring w-4 h-4"
              />
              <label htmlFor="isActive" className="text-xs font-medium text-foreground cursor-pointer">
                Enable Discord Notifications
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={handleTestDiscord}
              disabled={testing || !webhookUrl}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Send size={14} />
              <span>{testing ? 'Sending Test...' : 'Send Test Alert'}</span>
            </button>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
            >
              <Save size={14} />
              <span>{loading ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

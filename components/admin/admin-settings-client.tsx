'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Save, Send, CheckCircle2, AlertCircle, Shield } from 'lucide-react'

export function AdminSettingsClient() {
  const [webhookUrl, setWebhookUrl] = useState('')
  const [label, setLabel] = useState('Admin Alerts')
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetchConfig()
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

  async function handleSave(e: React.FormEvent) {
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

  async function handleTest() {
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

      {/* Discord Notification Card */}
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

        <form onSubmit={handleSave} className="space-y-4 pt-2 border-t border-border">
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
              onClick={handleTest}
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

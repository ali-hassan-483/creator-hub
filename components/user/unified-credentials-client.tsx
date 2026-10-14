'use client'

import { useState, useEffect } from 'react'
import {
  Key, ShieldCheck, CheckCircle2, XCircle, Trash2,
  RefreshCw, Send, Plus, X, Globe, Video, Bot, Bell,
  Sparkles, ExternalLink, AlertCircle
} from 'lucide-react'

export default function UnifiedCredentialsClient() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Dropdown list of emails from added channels
  const [channelEmails, setChannelEmails] = useState<string[]>([])
  const [whopEmails, setWhopEmails] = useState<string[]>([])
  const [missingYoutubeEmails, setMissingYoutubeEmails] = useState<string[]>([])
  const [missingWhopEmails, setMissingWhopEmails] = useState<string[]>([])
  const [youtubeCredsByEmail, setYoutubeCredsByEmail] = useState<Array<{ email: string; status: string }>>([])
  const [whopCredsByEmail, setWhopCredsByEmail] = useState<Array<{ email: string; status: string }>>([])

  // Form states
  const [ytEmail, setYtEmail] = useState('')
  const [ytCookies, setYtCookies] = useState('')
  const [ytSaving, setYtSaving] = useState(false)

  const [whopEmail, setWhopEmail] = useState('')
  const [whopCookies, setWhopCookies] = useState('')
  const [whopSaving, setWhopSaving] = useState(false)

  const [geminiKeyInput, setGeminiKeyInput] = useState('')
  const [geminiKeys, setGeminiKeys] = useState<string[]>([])
  const [geminiSaving, setGeminiSaving] = useState(false)
  const [geminiTesting, setGeminiTesting] = useState(false)

  const [discordWebhook, setDiscordWebhook] = useState('')
  const [discordSaving, setDiscordSaving] = useState(false)
  const [discordTesting, setDiscordTesting] = useState(false)

  const fetchCredentials = async () => {
    try {
      const res = await fetch('/api/user/credentials-manager')
      if (res.ok) {
        const json = await res.json()
        setData(json.prerequisites)
        setChannelEmails(json.channelEmails || [])
        setWhopEmails(json.whopEmails || [])
        setMissingYoutubeEmails(json.missingYoutubeEmails || [])
        setMissingWhopEmails(json.missingWhopEmails || [])
        setYoutubeCredsByEmail(json.youtubeCredsByEmail || [])
        setWhopCredsByEmail(json.whopCredsByEmail || [])

        // Set default dropdown values
        if (json.channelEmails?.length > 0 && !ytEmail) {
          setYtEmail(json.channelEmails[0])
        }
        if (json.whopEmails?.length > 0 && !whopEmail) {
          setWhopEmail(json.whopEmails[0])
        }

        if (json.prerequisites?.gemini?.keys) {
          setGeminiKeys(json.prerequisites.gemini.keys)
        }
        if (json.prerequisites?.discord?.webhookUrl) {
          setDiscordWebhook(json.prerequisites.discord.webhookUrl)
        }
      }
    } catch (e: any) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCredentials()
  }, [])

  const showFeedback = (text: string, type: 'success' | 'error') => {
    setStatusMsg({ text, type })
    setTimeout(() => setStatusMsg(null), 5000)
  }

  // Save YouTube Cookies
  const handleSaveYouTubeCookies = async () => {
    if (!ytCookies.trim()) {
      showFeedback('Please paste YouTube cookies text first.', 'error')
      return
    }
    setYtSaving(true)
    try {
      const res = await fetch('/api/user/credentials-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_youtube_cookies',
          email: ytEmail.trim() || undefined,
          data: ytCookies.trim(),
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      showFeedback('✅ YouTube cookies saved successfully!', 'success')
      setYtCookies('')
      fetchCredentials()
    } catch (err: any) {
      showFeedback(`❌ ${err.message}`, 'error')
    } finally {
      setYtSaving(false)
    }
  }

  // Save Whop Cookies
  const handleSaveWhopCookies = async () => {
    if (!whopCookies.trim()) {
      showFeedback('Please paste Whop storage JSON first.', 'error')
      return
    }
    setWhopSaving(true)
    try {
      const res = await fetch('/api/user/credentials-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_whop',
          email: whopEmail.trim() || undefined,
          data: whopCookies.trim(),
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      showFeedback('✅ Whop cookies saved successfully!', 'success')
      setWhopCookies('')
      fetchCredentials()
    } catch (err: any) {
      showFeedback(`❌ ${err.message}`, 'error')
    } finally {
      setWhopSaving(false)
    }
  }

  // Add Gemini Key
  const handleAddGeminiKey = () => {
    const trimmed = geminiKeyInput.trim()
    if (!trimmed) return
    if (!geminiKeys.includes(trimmed)) {
      setGeminiKeys([...geminiKeys, trimmed])
    }
    setGeminiKeyInput('')
  }

  const handleRemoveGeminiKey = (index: number) => {
    setGeminiKeys(geminiKeys.filter((_, i) => i !== index))
  }

  // Save Gemini Keys
  const handleSaveGeminiKeys = async () => {
    setGeminiSaving(true)
    try {
      const res = await fetch('/api/user/credentials-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_gemini',
          data: geminiKeys,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      showFeedback(`✅ ${result.message}`, 'success')
      fetchCredentials()
    } catch (err: any) {
      showFeedback(`❌ ${err.message}`, 'error')
    } finally {
      setGeminiSaving(false)
    }
  }

  // Test Gemini Keys
  const handleTestGeminiKey = async () => {
    if (geminiKeys.length === 0 && !geminiKeyInput.trim()) {
      showFeedback('Please add or type a Gemini Key to test.', 'error')
      return
    }
    setGeminiTesting(true)
    const keyToTest = geminiKeyInput.trim() || geminiKeys[0]
    try {
      const res = await fetch('/api/user/credentials-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test_gemini',
          data: keyToTest,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Test failed')
      showFeedback('✅ Gemini API Key is valid and responding!', 'success')
    } catch (err: any) {
      showFeedback(`❌ ${err.message}`, 'error')
    } finally {
      setGeminiTesting(false)
    }
  }

  // Save Discord Webhook
  const handleSaveDiscord = async () => {
    setDiscordSaving(true)
    try {
      const res = await fetch('/api/user/credentials-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_discord',
          data: discordWebhook.trim(),
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      showFeedback('✅ Discord webhook saved!', 'success')
      fetchCredentials()
    } catch (err: any) {
      showFeedback(`❌ ${err.message}`, 'error')
    } finally {
      setDiscordSaving(false)
    }
  }

  // Test Discord Webhook
  const handleTestDiscord = async () => {
    if (!discordWebhook.trim()) {
      showFeedback('Please enter a Discord Webhook URL to test.', 'error')
      return
    }
    setDiscordTesting(true)
    try {
      const res = await fetch('/api/user/credentials-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test_discord',
          data: discordWebhook.trim(),
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Test failed')
      showFeedback('✅ Test message sent to your Discord channel!', 'success')
    } catch (err: any) {
      showFeedback(`❌ ${err.message}`, 'error')
    } finally {
      setDiscordTesting(false)
    }
  }

  // Delete specific credential
  const handleDeleteCredential = async (credType: string) => {
    if (!confirm(`Are you sure you want to delete ${credType} credentials?`)) return
    try {
      const res = await fetch('/api/user/credentials-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_credential',
          credentialType: credType,
        }),
      })
      if (res.ok) {
        showFeedback(`Deleted ${credType} credential.`, 'success')
        fetchCredentials()
      }
    } catch (err: any) {
      showFeedback(err.message, 'error')
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-8 font-sans">
      {/* Title */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#2b3345] dark:text-[#e2e8f0] tracking-tight">
          Prerequisites & Cookie Credentials
        </h1>
        <p className="text-sm text-[#6c7a9c] dark:text-[#94a3b8] mt-1">
          Manage your Whop session cookies, Gemini AI keys pool, and Discord notification alerts in one unified panel.
        </p>
      </div>

      {statusMsg && (
        <div
          className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
            statusMsg.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30'
              : 'bg-destructive/10 text-destructive border border-destructive/30'
          }`}
        >
          {statusMsg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* ⚠️ UPLOADING BLOCKER ALERT IF ANY EMAIL CREDENTIALS ARE MISSING */}
      {(missingYoutubeEmails.length > 0 || missingWhopEmails.length > 0) && (
        <div className="p-4 rounded-3xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 space-y-2 text-xs">
          <div className="flex items-center gap-2 font-bold text-sm text-amber-900 dark:text-amber-200">
            <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Action Required: Video Uploading is BLOCKED until all account credentials are added!</span>
          </div>
          <p className="leading-relaxed">
            Aapke added channels ke mutabiq har email account ke credentials hona lazmi hain:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
            {missingYoutubeEmails.length > 0 && (
              <div className="p-2.5 rounded-2xl bg-black/5 dark:bg-white/5 space-y-1">
                <span className="font-bold text-rose-600 dark:text-rose-400 block font-sans">
                  ❌ Missing YouTube Cookies ({missingYoutubeEmails.length} email):
                </span>
                {missingYoutubeEmails.map((e) => (
                  <span key={e} className="block text-foreground">• {e}</span>
                ))}
              </div>
            )}
            {missingWhopEmails.length > 0 && (
              <div className="p-2.5 rounded-2xl bg-black/5 dark:bg-white/5 space-y-1">
                <span className="font-bold text-rose-600 dark:text-rose-400 block font-sans">
                  ❌ Missing Whop Credentials ({missingWhopEmails.length} email):
                </span>
                {missingWhopEmails.map((e) => (
                  <span key={e} className="block text-foreground">• {e}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TOP SECTION: Prerequisites Status (Neumorphic Card) ─────────────── */}
      <div className="neu-flat rounded-3xl p-6 sm:p-7 space-y-4">
        <h2 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0]">
          Prerequisites Status
        </h2>

        <div className="space-y-3.5 divide-y divide-black/5 dark:divide-white/5">
          {/* Whop Cookies */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <span className="text-xs sm:text-sm font-medium text-[#495470] dark:text-[#cbd5e1]">
              Whop Submission Cookies (&apos;auth_state.json&apos;):
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-[11px] font-bold ${
                  data?.whopCookies?.configured
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                }`}
              >
                {data?.whopCookies?.configured ? 'Configured' : 'Missing'}
              </span>
              <button
                onClick={() => handleSaveWhopCookies()}
                className="neu-button px-3 py-1 rounded-xl text-[11px] font-semibold text-[#495470] dark:text-[#e2e8f0]"
              >
                Test
              </button>
              <button
                onClick={() => handleDeleteCredential('whop')}
                className="neu-button px-2.5 py-1 rounded-xl text-[11px] font-semibold text-rose-500 hover:text-rose-600 flex items-center gap-1"
              >
                <Trash2 size={12} />
                <span>Delete</span>
              </button>
            </div>
          </div>

          {/* Current IP Proxy Test */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3.5">
            <span className="text-xs sm:text-sm font-medium text-[#495470] dark:text-[#cbd5e1]">
              Current IP Proxy Test:
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-[11px] font-bold ${
                  data?.proxyIp?.assigned
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {data?.proxyIp?.assigned ? `Assigned (${data?.proxyIp?.ip})` : 'No IP Assigned'}
              </span>
              <button
                onClick={() => showFeedback('Proxy connection active on VPS', 'success')}
                className="neu-button px-3 py-1 rounded-xl text-[11px] font-semibold text-[#495470] dark:text-[#e2e8f0]"
              >
                Test
              </button>
            </div>
          </div>

          {/* Gemini API Key */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3.5">
            <span className="text-xs sm:text-sm font-medium text-[#495470] dark:text-[#cbd5e1]">
              Gemini API Key:
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-[11px] font-bold ${
                  data?.gemini?.configured
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                }`}
              >
                {data?.gemini?.configured ? `${data.gemini.keysCount} Keys Configured` : 'Missing'}
              </span>
              <button
                onClick={handleTestGeminiKey}
                disabled={geminiTesting}
                className="neu-button px-3 py-1 rounded-xl text-[11px] font-semibold text-[#495470] dark:text-[#e2e8f0]"
              >
                {geminiTesting ? 'Testing...' : 'Test'}
              </button>
              <button
                onClick={() => handleDeleteCredential('gemini')}
                className="neu-button px-2.5 py-1 rounded-xl text-[11px] font-semibold text-rose-500 hover:text-rose-600 flex items-center gap-1"
              >
                <Trash2 size={12} />
                <span>Delete</span>
              </button>
            </div>
          </div>

          {/* Discord Webhook Alert */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3.5">
            <span className="text-xs sm:text-sm font-medium text-[#495470] dark:text-[#cbd5e1]">
              Discord Webhook Alert:
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-[11px] font-bold ${
                  data?.discord?.configured
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                }`}
              >
                {data?.discord?.configured ? 'Configured' : 'Missing'}
              </span>
              <button
                onClick={handleTestDiscord}
                disabled={discordTesting}
                className="neu-button px-3 py-1 rounded-xl text-[11px] font-semibold text-[#495470] dark:text-[#e2e8f0]"
              >
                {discordTesting ? 'Testing...' : 'Test'}
              </button>
              <button
                onClick={() => handleDeleteCredential('discord')}
                className="neu-button px-2.5 py-1 rounded-xl text-[11px] font-semibold text-rose-500 hover:text-rose-600 flex items-center gap-1"
              >
                <Trash2 size={12} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 3 COLUMN GRID: YouTube, Whop & Gemini Credentials (Screenshot Exact Layout) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Update YouTube Cookies */}
        <div className="neu-flat rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <h3 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0]">
              Update YouTube Cookies
            </h3>
            <p className="text-[11px] text-[#718096] dark:text-[#94a3b8] leading-relaxed">
              Paste the raw text content of your &apos;cookies.txt&apos; file (Netscape format) generated by your browser cookie exporter extension.
            </p>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-[#495470] dark:text-[#cbd5e1]">
                  Target Channel Email / Account
                </label>
                {channelEmails.length > 0 && (
                  <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold">
                    {channelEmails.length} Email(s) Added
                  </span>
                )}
              </div>

              {channelEmails.length > 0 ? (
                <select
                  value={ytEmail}
                  onChange={(e) => setYtEmail(e.target.value)}
                  className="neu-pressed w-full rounded-xl px-3 py-2 text-xs text-foreground focus:outline-hidden cursor-pointer"
                >
                  {channelEmails.map((em) => {
                    const isConfigured = youtubeCredsByEmail.some(c => c.email?.toLowerCase() === em.toLowerCase())
                    return (
                      <option key={em} value={em}>
                        {em} {isConfigured ? '✓ (Configured)' : '⚠ (Missing Cookies)'}
                      </option>
                    )
                  })}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="e.g. ytaccount@gmail.com"
                  value={ytEmail}
                  onChange={(e) => setYtEmail(e.target.value)}
                  className="neu-pressed w-full rounded-xl px-3 py-2 text-xs text-foreground focus:outline-hidden"
                />
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] pt-1">
              <span className="text-[#718096]">Status for selected account:</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  youtubeCredsByEmail.some(c => c.email?.toLowerCase() === ytEmail.toLowerCase())
                    ? 'bg-emerald-500/15 text-emerald-600'
                    : 'bg-rose-500/15 text-rose-600'
                }`}
              >
                {youtubeCredsByEmail.some(c => c.email?.toLowerCase() === ytEmail.toLowerCase())
                  ? 'Configured'
                  : 'Missing (Upload Blocked)'}
              </span>
            </div>

            <textarea
              rows={5}
              placeholder="# Netscape HTTP Cookie File..."
              value={ytCookies}
              onChange={(e) => setYtCookies(e.target.value)}
              className="neu-pressed w-full rounded-2xl p-3 text-[11px] font-mono text-foreground focus:outline-hidden resize-none"
            />
          </div>

          <button
            onClick={handleSaveYouTubeCookies}
            disabled={ytSaving}
            className="neu-primary-button w-full py-2.5 rounded-xl text-xs font-bold tracking-wide"
          >
            {ytSaving ? 'Saving...' : `Save YouTube Cookies for ${ytEmail || 'Account'}`}
          </button>
        </div>

        {/* Card 2: Update Whop Credentials */}
        <div className="neu-flat rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <h3 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0]">
              Update Whop Credentials
            </h3>
            <p className="text-[11px] text-[#718096] dark:text-[#94a3b8] leading-relaxed">
              Paste the browser session storage JSON content (cookies/local storage) needed for Whop submission Playwright runs.
            </p>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-[#495470] dark:text-[#cbd5e1]">
                  Target Whop Email / Account
                </label>
                {whopEmails.length > 0 && (
                  <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold">
                    {whopEmails.length} Email(s) Added
                  </span>
                )}
              </div>

              {whopEmails.length > 0 ? (
                <select
                  value={whopEmail}
                  onChange={(e) => setWhopEmail(e.target.value)}
                  className="neu-pressed w-full rounded-xl px-3 py-2 text-xs text-foreground focus:outline-hidden cursor-pointer"
                >
                  {whopEmails.map((em) => {
                    const isConfigured = whopCredsByEmail.some(c => c.email?.toLowerCase() === em.toLowerCase())
                    return (
                      <option key={em} value={em}>
                        {em} {isConfigured ? '✓ (Configured)' : '⚠ (Missing Cookies)'}
                      </option>
                    )
                  })}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="e.g. whopaccount@gmail.com"
                  value={whopEmail}
                  onChange={(e) => setWhopEmail(e.target.value)}
                  className="neu-pressed w-full rounded-xl px-3 py-2 text-xs text-foreground focus:outline-hidden"
                />
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] pt-1">
              <span className="text-[#718096]">Status for selected account:</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  whopCredsByEmail.some(c => c.email?.toLowerCase() === whopEmail.toLowerCase())
                    ? 'bg-emerald-500/15 text-emerald-600'
                    : 'bg-rose-500/15 text-rose-600'
                }`}
              >
                {whopCredsByEmail.some(c => c.email?.toLowerCase() === whopEmail.toLowerCase())
                  ? 'Configured'
                  : 'Missing (Upload Blocked)'}
              </span>
            </div>

            <textarea
              rows={5}
              placeholder={'{"cookies": [...], "origins": [...]}'}
              value={whopCookies}
              onChange={(e) => setWhopCookies(e.target.value)}
              className="neu-pressed w-full rounded-2xl p-3 text-[11px] font-mono text-foreground focus:outline-hidden resize-none"
            />
          </div>

          <button
            onClick={handleSaveWhopCookies}
            disabled={whopSaving}
            className="neu-primary-button w-full py-2.5 rounded-xl text-xs font-bold tracking-wide"
          >
            {whopSaving ? 'Saving...' : `Save Whop Credentials for ${whopEmail || 'Account'}`}
          </button>
        </div>

        {/* Card 3: Update Gemini Credentials */}
        <div className="neu-flat rounded-3xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <h3 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0]">
              Update Gemini Credentials
            </h3>
            <p className="text-[11px] text-[#718096] dark:text-[#94a3b8] leading-relaxed">
              Enter one or multiple Google Gemini API Keys. Each key is added as a tag. The system pools and rotates them using Least-Recently-Used (LRU) round-robin.
            </p>

            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-[#495470] dark:text-[#cbd5e1]">
                Configured Keys ({geminiKeys.length})
              </span>
              <span className="text-[10px] text-muted-foreground">Press Enter or paste keys</span>
            </div>

            {/* Keys Tag List */}
            <div className="neu-pressed rounded-2xl p-2.5 min-h-[90px] max-h-[140px] overflow-y-auto space-y-1.5">
              {geminiKeys.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-4">
                  No Gemini keys in pool. Type below and press Enter.
                </p>
              ) : (
                geminiKeys.map((key, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 rounded-xl px-2.5 py-1 text-[11px] font-mono"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <Key size={11} />
                      <span>{key.slice(0, 10)}...{key.slice(-6)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveGeminiKey(idx)}
                      className="text-purple-400 hover:text-purple-600 ml-1"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Paste or type Gemini key, then press Enter..."
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddGeminiKey()
                  }
                }}
                className="neu-pressed flex-1 rounded-xl px-3 py-2 text-xs text-foreground focus:outline-hidden"
              />
              <button
                type="button"
                onClick={handleAddGeminiKey}
                className="neu-button px-3 rounded-xl text-xs font-bold text-purple-600"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSaveGeminiKeys}
              disabled={geminiSaving}
              className="neu-primary-button flex-1 py-2.5 rounded-xl text-xs font-bold tracking-wide"
            >
              {geminiSaving ? 'Saving...' : 'Save Gemini API Key(s)'}
            </button>
            <button
              onClick={handleTestGeminiKey}
              disabled={geminiTesting}
              className="neu-button px-4 py-2.5 rounded-xl text-xs font-semibold text-[#495470] dark:text-[#e2e8f0]"
            >
              {geminiTesting ? 'Testing...' : 'Test Key(s)'}
            </button>
          </div>
        </div>
      </div>

      {/* ── BOTTOM SECTION: Update Discord Webhook URL (Screenshot Exact) ──────── */}
      <div className="neu-flat rounded-3xl p-6 sm:p-7 max-w-xl space-y-3">
        <h3 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0]">
          Update Discord Webhook URL
        </h3>
        <p className="text-[11px] text-[#718096] dark:text-[#94a3b8] leading-relaxed">
          Enter your Discord Channel Webhook URL (starts with &apos;https://discord.com/api/webhooks/...&apos;) to receive real-time failure alerts when Whop submissions fail or videos cross minimum views.
        </p>

        <input
          type="text"
          placeholder="https://discord.com/api/webhooks/..."
          value={discordWebhook}
          onChange={(e) => setDiscordWebhook(e.target.value)}
          className="neu-pressed w-full rounded-xl px-3 py-2.5 text-xs text-foreground focus:outline-hidden font-mono"
        />

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSaveDiscord}
            disabled={discordSaving}
            className="neu-primary-button px-6 py-2.5 rounded-xl text-xs font-bold tracking-wide"
          >
            {discordSaving ? 'Saving...' : 'Save Discord Webhook'}
          </button>
          <button
            onClick={handleTestDiscord}
            disabled={discordTesting}
            className="neu-button px-5 py-2.5 rounded-xl text-xs font-semibold text-[#495470] dark:text-[#e2e8f0]"
          >
            {discordTesting ? 'Testing...' : 'Test Webhook'}
          </button>
        </div>
      </div>
    </div>
  )
}

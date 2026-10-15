'use client'

import { useState, useEffect } from 'react'
import {
  Zap, Calendar, Clock, CheckSquare, Square,
  Filter, AlertCircle, CheckCircle2, Trash2,
  X, RefreshCw, ChevronDown, Sparkles
} from 'lucide-react'

interface ChannelAccount {
  id: string
  name: string
  handle: string
  niche: string
  email: string
  whopEmail: string
  status: string
  usedCount: number
}

interface CampaignOption {
  id: string
  name: string
  description?: string | null
  config?: any
}

interface ScheduleItem {
  id: string
  name?: string | null
  campaign?: { name: string } | null
  options?: any
  createdAt: string
  channels: Array<{ channel: { channelHandle?: string; channelName?: string } }>
}

export default function QueueClippingAutomationClient() {
  const [loading, setLoading] = useState(true)
  const [channels, setChannels] = useState<ChannelAccount[]>([])
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])

  // Filter States
  const [nicheFilter, setNicheFilter] = useState('All Niches')
  const [emailFilter, setEmailFilter] = useState('All Emails')
  const [whopEmailFilter, setWhopEmailFilter] = useState('All Whop Emails')

  // Selection States
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState('')

  // Action feedback
  const [running, setRunning] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // 🗓️ Schedule Modal State
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false)
  const [repeatDays, setRepeatDays] = useState(7)
  const [timesPerDay, setTimesPerDay] = useState(1)
  const [autoRerunCount, setAutoRerunCount] = useState(0)
  const [cancelOnFailure, setCancelOnFailure] = useState(false)
  const [runParallel, setRunParallel] = useState(false)
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(['09:00 AM'])
  const [savingSchedule, setSavingSchedule] = useState(false)

  const fetchContext = async () => {
    try {
      const res = await fetch('/api/user/automation')
      if (res.ok) {
        const data = await res.json()
        setChannels(data.channels || [])
        setCampaigns(data.campaigns || [])
        setSchedules(data.schedules || [])
      }
    } catch (e: any) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchContext()
  }, [])

  // Auto-adjust schedule times when timesPerDay changes
  useEffect(() => {
    const defaultHours = ['09:00 AM', '02:00 PM', '07:00 PM', '11:00 PM', '06:00 AM', '12:00 PM']
    const newTimes: string[] = []
    for (let i = 0; i < timesPerDay; i++) {
      newTimes.push(scheduleTimes[i] || defaultHours[i % defaultHours.length])
    }
    setScheduleTimes(newTimes)
  }, [timesPerDay])

  const showFeedback = (text: string, type: 'success' | 'error') => {
    setStatusMsg({ text, type })
    setTimeout(() => setStatusMsg(null), 5000)
  }

  // Filter options derived from channel accounts
  const niches = ['All Niches', ...Array.from(new Set(channels.map((c) => c.niche).filter(Boolean)))]
  const emails = ['All Emails', ...Array.from(new Set(channels.map((c) => c.email).filter(Boolean)))]
  const whopEmails = ['All Whop Emails', ...Array.from(new Set(channels.map((c) => c.whopEmail).filter(Boolean)))]

  // Filtered channels list
  const filteredChannels = channels.filter((c) => {
    const matchesNiche = nicheFilter === 'All Niches' || c.niche === nicheFilter
    const matchesEmail = emailFilter === 'All Emails' || c.email === emailFilter
    const matchesWhopEmail = whopEmailFilter === 'All Whop Emails' || c.whopEmail === whopEmailFilter
    return matchesNiche && matchesEmail && matchesWhopEmail
  })

  // Select / Deselect All
  const handleSelectAll = () => {
    if (selectedChannelIds.length === filteredChannels.length) {
      setSelectedChannelIds([])
    } else {
      setSelectedChannelIds(filteredChannels.map((c) => c.id))
    }
  }

  const toggleChannel = (id: string) => {
    if (selectedChannelIds.includes(id)) {
      setSelectedChannelIds(selectedChannelIds.filter((cid) => cid !== id))
    } else {
      setSelectedChannelIds([...selectedChannelIds, id])
    }
  }

  // Instant Run Now
  const handleRunNow = async () => {
    if (selectedChannelIds.length === 0) {
      showFeedback('Please select at least one channel account.', 'error')
      return
    }
    if (!selectedCampaignId) {
      showFeedback('Please select a campaign to process.', 'error')
      return
    }

    setRunning(true)
    try {
      const res = await fetch('/api/user/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run_now',
          channelIds: selectedChannelIds,
          campaignId: selectedCampaignId,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to start automation')

      showFeedback(`🚀 ${result.message}`, 'success')
      fetchContext()
    } catch (err: any) {
      showFeedback(`❌ ${err.message}`, 'error')
    } finally {
      setRunning(false)
    }
  }

  // Open Schedule Modal
  const handleOpenScheduleModal = () => {
    if (selectedChannelIds.length === 0) {
      showFeedback('Please select at least one channel account before scheduling.', 'error')
      return
    }
    if (!selectedCampaignId) {
      showFeedback('Please select a campaign to process before scheduling.', 'error')
      return
    }
    setIsScheduleModalOpen(true)
  }

  // Save Schedule Cycle
  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSchedule(true)

    try {
      const res = await fetch('/api/user/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'schedule_cycle',
          channelIds: selectedChannelIds,
          campaignId: selectedCampaignId,
          scheduleConfig: {
            repeatDays,
            timesPerDay,
            autoRerunOnFailure: autoRerunCount,
            cancelOnFailure,
            parallelFixer: runParallel,
            scheduleTimes,
          },
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to schedule')

      showFeedback(`📅 ${result.message}`, 'success')
      setIsScheduleModalOpen(false)
      fetchContext()
    } catch (err: any) {
      showFeedback(`❌ ${err.message}`, 'error')
    } finally {
      setSavingSchedule(false)
    }
  }

  // Clear Inactive Schedules
  const handleClearInactive = async () => {
    try {
      const res = await fetch('/api/user/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_inactive' }),
      })
      if (res.ok) {
        showFeedback('Cleared inactive schedules.', 'success')
        fetchContext()
      }
    } catch (err: any) {
      showFeedback(err.message, 'error')
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-7 font-sans">
      {/* Title */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#2b3345] dark:text-[#e2e8f0] tracking-tight">
          Queue Clipping Automation
        </h1>
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

      {/* ── 2 COLUMN LAYOUT: Form on Left, Active Schedules on Right (Screenshot 1) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Execute Clipping Cycle */}
        <div className="lg:col-span-7 neu-flat rounded-3xl p-6 sm:p-7 space-y-5">
          <div>
            <h2 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0]">
              Execute clipping cycle
            </h2>
            <p className="text-[11px] text-[#718096] dark:text-[#94a3b8] mt-0.5">
              This triggers the background n8n workflow cycle dynamically using your selected configurations.
            </p>
          </div>

          {/* Channel Select Header */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#495470] dark:text-[#cbd5e1]">
              Select Target Channel Accounts{' '}
              <span className="text-purple-600 dark:text-purple-400 font-bold">
                ({selectedChannelIds.length} selected)
              </span>
            </span>
            <button
              type="button"
              onClick={handleSelectAll}
              className="neu-button px-3 py-1 rounded-xl text-[11px] font-semibold text-purple-600 dark:text-purple-400"
            >
              {selectedChannelIds.length === filteredChannels.length && filteredChannels.length > 0
                ? 'Deselect All'
                : 'Select All'}
            </button>
          </div>

          {/* 3 Filters (Niche, Email, Whop Email) */}
          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#6c7a9c] dark:text-[#94a3b8] text-[11px] font-medium w-28 shrink-0">
                Filter by Niche:
              </span>
              <select
                value={nicheFilter}
                onChange={(e) => setNicheFilter(e.target.value)}
                className="neu-pressed w-full rounded-xl px-3 py-2 text-xs text-foreground cursor-pointer"
              >
                {niches.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[#6c7a9c] dark:text-[#94a3b8] text-[11px] font-medium w-28 shrink-0">
                Filter by Email:
              </span>
              <select
                value={emailFilter}
                onChange={(e) => setEmailFilter(e.target.value)}
                className="neu-pressed w-full rounded-xl px-3 py-2 text-xs text-foreground cursor-pointer"
              >
                {emails.map((em) => (
                  <option key={em} value={em}>
                    {em}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[#6c7a9c] dark:text-[#94a3b8] text-[11px] font-medium w-28 shrink-0">
                Filter by Whop Email:
              </span>
              <select
                value={whopEmailFilter}
                onChange={(e) => setWhopEmailFilter(e.target.value)}
                className="neu-pressed w-full rounded-xl px-3 py-2 text-xs text-foreground cursor-pointer"
              >
                {whopEmails.map((we) => (
                  <option key={we} value={we}>
                    {we}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Scrollable Channel Checkbox List (Exact Screenshot 1 Layout) */}
          <div className="neu-pressed rounded-2xl p-3 max-h-56 overflow-y-auto space-y-2 text-xs">
            {filteredChannels.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-6">
                No channel accounts match the selected filters.
              </p>
            ) : (
              filteredChannels.map((ch) => {
                const isSelected = selectedChannelIds.includes(ch.id)
                return (
                  <label
                    key={ch.id}
                    className={`flex items-start gap-2.5 p-2 rounded-xl cursor-pointer transition-colors ${
                      isSelected ? 'bg-purple-500/10' : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleChannel(ch.id)}
                      className="mt-1 h-3.5 w-3.5 rounded-sm accent-purple-600"
                    />
                    <div className="leading-tight flex-1 text-[11px] font-mono text-[#495470] dark:text-[#cbd5e1]">
                      <span className="font-bold text-[#2b3345] dark:text-[#f1f5f9]">
                        {ch.handle || ch.name}
                      </span>{' '}
                      (Niche: {ch.niche}, Email: {ch.email}, Whop Email: {ch.whopEmail})
                    </div>
                  </label>
                )
              })
            )}
          </div>

          {/* Select Campaign Dropdown */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[#495470] dark:text-[#cbd5e1] block">
              Select Campaign to Process
            </label>
            <select
              value={selectedCampaignId}
              onChange={(e) => setSelectedCampaignId(e.target.value)}
              className="neu-pressed w-full rounded-xl px-3 py-2.5 text-xs text-foreground cursor-pointer font-medium"
            >
              <option value="">-- Select a Campaign --</option>
              {campaigns.map((camp) => (
                <option key={camp.id} value={camp.id}>
                  {camp.name}
                </option>
              ))}
            </select>
          </div>

          {/* Action Buttons: Run Now & Schedule Cycle */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={handleRunNow}
              disabled={running}
              className="neu-primary-button py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
            >
              {running ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  <span>Queueing...</span>
                </>
              ) : (
                <>
                  <Zap size={14} />
                  <span>🚀 Run Now</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleOpenScheduleModal}
              className="neu-button py-2.5 rounded-xl text-xs font-semibold text-[#495470] dark:text-[#e2e8f0] flex items-center justify-center gap-1.5"
            >
              <Calendar size={14} className="text-purple-600" />
              <span>🗓️ Schedule Cycle</span>
            </button>
          </div>
        </div>

        {/* Right Column: Active Schedules (Screenshot 1 Right) */}
        <div className="lg:col-span-5 neu-flat rounded-3xl p-6 sm:p-7 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0]">
              Active Schedules
            </h2>
            <button
              type="button"
              onClick={handleClearInactive}
              className="neu-button px-2.5 py-1 rounded-xl text-[10px] font-semibold text-rose-500 hover:text-rose-600 flex items-center gap-1"
            >
              <Trash2 size={11} />
              <span>Clear Inactive</span>
            </button>
          </div>
          <p className="text-[11px] text-[#718096] dark:text-[#94a3b8]">
            List of active automation recurring schedules.
          </p>

          <div className="space-y-3 pt-1">
            {schedules.length === 0 ? (
              <p className="text-xs text-[#718096] dark:text-[#94a3b8] italic py-4">
                No active schedules configured.
              </p>
            ) : (
              schedules.map((sc) => {
                const opt = sc.options || {}
                return (
                  <div key={sc.id} className="neu-pressed rounded-2xl p-3.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#2b3345] dark:text-[#f1f5f9]">
                        {sc.campaign?.name || sc.name || 'Automation Schedule'}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-600">
                        Active
                      </span>
                    </div>
                    <p className="text-[11px] text-[#6c7a9c] dark:text-[#94a3b8]">
                      Repeat: {opt.repeatDays || 7} days · {opt.timesPerDay || 1}x daily
                    </p>
                    {opt.scheduleTimes?.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {opt.scheduleTimes.map((t: string, idx: number) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 font-mono text-[10px]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* ── SCHEDULE MODAL (Screenshot 2 Exact Form with Dynamic Times) ──────── */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="neu-flat rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-black/5 dark:border-white/5 pb-3">
              <h3 className="text-base font-bold text-[#2b3345] dark:text-[#e2e8f0] flex items-center gap-2">
                <span>🗓️</span>
                <span>Schedule Automation Cycle</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSchedule} className="space-y-4 text-xs">
              {/* Field 1: Kitna din ke liye lagana hai (Repeat for X number of days) */}
              <div>
                <label className="block text-[11px] font-semibold text-[#495470] dark:text-[#cbd5e1] mb-1">
                  Repeat for X number of days
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={repeatDays}
                  onChange={(e) => setRepeatDays(parseInt(e.target.value) || 1)}
                  className="neu-pressed w-full rounded-xl px-3 py-2 text-xs text-foreground focus:outline-hidden"
                />
              </div>

              {/* Field 2: Din me kitna time run ho (Repeat Y times a day) */}
              <div>
                <label className="block text-[11px] font-semibold text-[#495470] dark:text-[#cbd5e1] mb-1">
                  Repeat Y times a day
                </label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  required
                  value={timesPerDay}
                  onChange={(e) => setTimesPerDay(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="neu-pressed w-full rounded-xl px-3 py-2 text-xs text-foreground focus:outline-hidden"
                />
              </div>

              {/* Field 3: Auto rerun count on failure */}
              <div>
                <label className="block text-[11px] font-semibold text-[#495470] dark:text-[#cbd5e1] mb-1">
                  Auto rerun count on failure
                </label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={autoRerunCount}
                  onChange={(e) => setAutoRerunCount(parseInt(e.target.value) || 0)}
                  className="neu-pressed w-full rounded-xl px-3 py-2 text-xs text-foreground focus:outline-hidden"
                />
              </div>

              {/* Checkbox Options */}
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-[#495470] dark:text-[#cbd5e1]">
                  <input
                    type="checkbox"
                    checked={cancelOnFailure}
                    onChange={(e) => setCancelOnFailure(e.target.checked)}
                    className="rounded-sm accent-purple-600"
                  />
                  <span>Cancel/Stop run on failure</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-[#495470] dark:text-[#cbd5e1]">
                  <input
                    type="checkbox"
                    checked={runParallel}
                    onChange={(e) => setRunParallel(e.target.checked)}
                    className="rounded-sm accent-purple-600"
                  />
                  <span>Run YT Fixer & Whop in Parallel</span>
                </label>
              </div>

              {/* Field 4 (Dynamic): Jitna times run ho utne times show ho jayein! */}
              <div className="space-y-2 pt-1 border-t border-black/5 dark:border-white/5">
                <label className="block text-[11px] font-bold text-[#2b3345] dark:text-[#e2e8f0]">
                  Set Schedule Times ({timesPerDay} run{timesPerDay > 1 ? 's' : ''} per day)
                </label>

                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {scheduleTimes.map((t, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-[#6c7a9c] dark:text-[#94a3b8] w-16">
                        Time {idx + 1}:
                      </span>
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="text"
                          value={t}
                          onChange={(e) => {
                            const updated = [...scheduleTimes]
                            updated[idx] = e.target.value
                            setScheduleTimes(updated)
                          }}
                          placeholder="e.g. 09:00 AM"
                          className="neu-pressed flex-1 rounded-xl px-3 py-1.5 text-xs text-foreground font-mono focus:outline-hidden"
                        />
                        <Clock size={14} className="text-[#6c7a9c]" />
                      </div>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        PKT (GMT+5)
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={savingSchedule}
                  className="neu-primary-button w-full py-2.5 rounded-xl text-xs font-bold tracking-wide"
                >
                  {savingSchedule ? 'Saving Schedule...' : 'Save and Start Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

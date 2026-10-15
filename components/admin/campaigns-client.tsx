'use client'

import { useState, useEffect } from 'react'
import {
  Megaphone, Plus, Search, Trash2, Users,
  CheckCircle2, PauseCircle, Clock, AlertCircle,
  Eye, Settings, Layers, Download, Sparkles, RefreshCw,
  FileSpreadsheet, FileJson, Check, ExternalLink, HelpCircle,
  Type, Palette, Film, Captions, Link as LinkIcon, Image, Sliders, Upload, Edit,
  Loader2, HardDriveDownload, CircleAlert
} from 'lucide-react'
import { CampaignPreviewMockup } from './campaign-preview-mockup'

interface UserOption {
  id: string
  name: string | null
  email: string
}

interface CampaignItem {
  id: string
  name: string
  description: string | null
  status: 'draft' | 'active' | 'paused' | 'ended'
  minViews: number | null
  config: any
  createdAt: string
  assignedUsers: UserOption[]
  pendingTasksCount: number
  automationsCount: number
  earningsCount: number
  availableClips?: number
  sourceFilesCount?: number
}

interface CampaignsClientProps {
  initialCampaigns: CampaignItem[]
  allUsers: UserOption[]
}

const defaultBanners = [
  {
    text: '',
    font: 'Montenegrin Gothic One',
    textColor: 'white',
    positionHeightPercent: 85,
    fontSizePx: 54,
    background: 'red@0.8',
    styledWordCount: 0,
    styledWordsColor: 'yellow',
    showOnlyInLastSeconds: 'No' as 'No' | 'Yes',
    lastNDuration: 5,
  },
  {
    text: '',
    font: 'Montenegrin Gothic One',
    textColor: 'white',
    positionHeightPercent: 90,
    fontSizePx: 54,
    background: 'black@0.8',
    styledWordCount: 0,
    styledWordsColor: 'yellow',
    showOnlyInLastSeconds: 'No' as 'No' | 'Yes',
    lastNDuration: 5,
  },
  {
    text: '',
    font: 'Montenegrin Gothic One',
    textColor: 'white',
    positionHeightPercent: 75,
    fontSizePx: 54,
    background: 'red@0.8',
    styledWordCount: 0,
    styledWordsColor: 'yellow',
    showOnlyInLastSeconds: 'No' as 'No' | 'Yes',
    lastNDuration: 5,
  },
  {
    text: '',
    font: 'Montenegrin Gothic One',
    textColor: 'white',
    positionHeightPercent: 70,
    fontSizePx: 54,
    background: 'red@0.8',
    styledWordCount: 0,
    styledWordsColor: 'yellow',
    showOnlyInLastSeconds: 'No' as 'No' | 'Yes',
    lastNDuration: 5,
  },
  {
    text: '',
    font: 'Montenegrin Gothic One',
    textColor: 'white',
    positionHeightPercent: 65,
    fontSizePx: 54,
    background: 'red@0.8',
    styledWordCount: 0,
    styledWordsColor: 'yellow',
    showOnlyInLastSeconds: 'No' as 'No' | 'Yes',
    lastNDuration: 5,
  },
]

const defaultFormState = {
  // AI brief scanner
  briefText: '',

  // Identity (Screenshot 1)
  name: '',
  niche: '',
  status: 'active' as 'draft' | 'active' | 'paused' | 'ended',
  readyToPost: 'no' as 'no' | 'yes',
  subcampaignGid: '',
  submissionLink: '',

  // Rules & Source Material (Screenshot 2)
  fixYoutubeMentions: 'no' as 'no' | 'yes',
  whopChannelName: '',
  cpm: '',
  enablePendingTasks: 'disabled' as 'disabled' | 'enabled',
  dailyPostLimit: 45,
  sourceVideoUrls: '',
  specifyTimeRanges: false,
  minViews: 0,
  minEngagementRate: 0,
  audioNotes: '',

  // Clipping & Timing (Screenshot 3)
  clippingStrategies: ['multi_cut'] as string[],
  shortDuration: 25,
  startOffset: 0,
  volumeMultiplier: 1.0,
  hookVideoUrls: '',
  ctaVideoUrls: '',

  // On-Screen Text & Content AI (Screenshot 3 & 4)
  onScreenTextPool: '',
  singleOnScreenTextOnly: 'no' as 'no' | 'yes',
  ftcDisclosure: '',
  onScreenTextAiGuide: '',
  onScreenMaxCharacters: 50,
  titlesAiGuide: '',
  descriptionsAiGuide: '',
  maxTitleCharacters: 60,
  predefinedDescription: '',

  // Descriptions & Links (New Screenshot 1)
  useOnlyPredefinedDesc: false,
  linksInDescription: '',

  // Visual Overlay & Styling (New Screenshot 1)
  logoOverlayUrl: '',
  overlayPosition: 'Bottom Center',
  overlayWidthPercent: 60,

  // Bottom Banners (New Screenshot 2)
  numBottomBanners: 1, // 0 to 5
  banners: defaultBanners,

  // On-screen Text Styling (New Screenshot 3)
  onScreenFontName: 'Montenegrin Gothic One',
  useSameFontForBannersAndSubs: false,
  onScreenTextColor: 'white',
  onScreenPositionHeightPercent: 27,
  onScreenSizePx: 64,
  onScreenBackground: 'black@0.5',
  onScreenStyledWordCount: 0,
  onScreenStyledWordsColor: 'yellow',
  useSameForSpeakingWordHighlight: false,

  // Video Layout & Styling (New Screenshot 3 & 4)
  backgroundStyles: ['Split Mirror Blur'] as string[],
  foregroundCornerStyles: ['Sharp Rectangular Edges'] as string[],

  // Subtitles (New Screenshot 4)
  enableSubtitles: 'Disabled (Fallback to AI Captions)',
  subtitleFonts: 'Montenegrin Gothic One',
  subtitleColors: 'white',
  outlineColors: 'black',
  subtitleWordSize: 100,
  subtitlesPlacementHeightPercent: 80,
  maxWordsPerScreen: 5,
  speakingWordHighlight: 'yellow',
  subtitleTextCases: ['ALL UPPERCASE'] as string[],

  // Admin Guide Links & Styling Presets (New Screenshot 5)
  adminGuideLinks: '',
  useStylingPresets: false,

  // Access
  assignAllUsers: true,
  assignedUserIds: [] as string[],
}

export function CampaignsClient({ initialCampaigns, allUsers }: CampaignsClientProps) {
  const [campaigns, setCampaigns] = useState<CampaignItem[]>(initialCampaigns)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<CampaignItem | null>(null)
  const [accessModalCampaign, setAccessModalCampaign] = useState<CampaignItem | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [uploadModalCampaign, setUploadModalCampaign] = useState<CampaignItem | null>(null)
  const [uploadTargetType, setUploadTargetType] = useState<'sources' | 'clips'>('sources')
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatusMsg, setUploadStatusMsg] = useState('')
  const [poolStatus, setPoolStatus] = useState<{ sourceFilesCount: number; editedClipsCount: number } | null>(null)

  // Form State
  const [formData, setFormData] = useState(defaultFormState)
  const [loading, setLoading] = useState(false)
  const [aiScanning, setAiScanning] = useState(false)
  const [aiMessage, setAiMessage] = useState('')
  const [error, setError] = useState('')

  // Setup/Download and Clip Generation Status Tracking
  const [setupStatuses, setSetupStatuses] = useState<Record<string, {
    sourceStatus: string
    progress: string | null
    sourceCount: number
    clipCount: number
    error: string | null
    clipStatus: 'generating' | 'queued' | 'ready' | 'error' | 'pending'
    clipProgress: string | null
    clipError: string | null
  }>>({})

  // Poll setup statuses every 5 seconds
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null

    async function fetchSetupStatuses() {
      try {
        const res = await fetch('/api/admin/campaigns/setup-status')
        if (res.ok) {
          const data = await res.json()
          const map: Record<string, any> = {}
          for (const s of data.statuses || []) {
            map[s.campaignId] = {
              sourceStatus: s.sourceStatus || s.status || 'pending',
              progress: s.progress,
              sourceCount: s.sourceCount ?? 0,
              clipCount: s.clipCount ?? 0,
              error: s.error,
              clipStatus: s.clipStatus || 'pending',
              clipProgress: s.clipProgress,
              clipError: s.clipError,
            }
          }
          setSetupStatuses(map)
        }
      } catch {}
    }

    fetchSetupStatuses()
    interval = setInterval(fetchSetupStatuses, 5000)

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [campaigns])

  async function handleRetriggerSetup(campaignId: string) {
    try {
      await fetch('/api/admin/campaigns/setup-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, force: true }),
      })
      // Immediately update local status
      setSetupStatuses((prev) => ({
        ...prev,
        [campaignId]: {
          ...prev[campaignId],
          sourceStatus: 'downloading',
          progress: '📥 Starting campaign setup...',
          error: null,
        },
      }))
    } catch {}
  }

  async function handleGenerateClips(campaignId: string) {
    try {
      await fetch('/api/admin/campaigns/setup-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, action: 'generate_clips' }),
      })
      setSetupStatuses((prev) => ({
        ...prev,
        [campaignId]: {
          ...prev[campaignId],
          clipStatus: 'generating',
          clipProgress: '⚙️ Starting clip generation...',
          clipError: null,
        },
      }))
    } catch {}
  }

  // Filter
  const filteredCampaigns = campaigns.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.config?.niche && c.config.niche.toLowerCase().includes(search.toLowerCase())) ||
      (c.config?.whopChannelName && c.config.whopChannelName.toLowerCase().includes(search.toLowerCase()))

    const matchesStatus = statusFilter === 'all' ? true : c.status === statusFilter
    return matchesSearch && matchesStatus
  })

  async function refreshCampaigns() {
    try {
      const res = await fetch('/api/admin/campaigns')
      if (res.ok) {
        const data = await res.json()
        setCampaigns(data)
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function handleOpenUploadModal(c: CampaignItem) {
    setUploadModalCampaign(c)
    setUploadFiles(null)
    setUploadStatusMsg('')
    setPoolStatus(null)
    try {
      const res = await fetch(`/api/admin/campaigns/upload-clips?campaignId=${c.id}`)
      if (res.ok) {
        const data = await res.json()
        setPoolStatus({
          sourceFilesCount: data.sourceFilesCount,
          editedClipsCount: data.editedClipsCount,
        })
      }
    } catch {}
  }

  async function handleUploadFiles(e: React.FormEvent) {
    e.preventDefault()
    if (!uploadModalCampaign || !uploadFiles || uploadFiles.length === 0) return

    setUploading(true)
    setUploadStatusMsg('')

    try {
      const fd = new FormData()
      fd.append('campaignId', uploadModalCampaign.id)
      fd.append('targetType', uploadTargetType)
      for (let i = 0; i < uploadFiles.length; i++) {
        fd.append('files', uploadFiles[i])
      }

      const res = await fetch('/api/admin/campaigns/upload-clips', {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setUploadStatusMsg(`✅ Successfully uploaded ${data.uploadedFiles?.length || uploadFiles.length} file(s)!`)
      setUploadFiles(null)

      // Refresh pool status
      const poolRes = await fetch(`/api/admin/campaigns/upload-clips?campaignId=${uploadModalCampaign.id}`)
      if (poolRes.ok) {
        const poolData = await poolRes.json()
        setPoolStatus({
          sourceFilesCount: poolData.sourceFilesCount,
          editedClipsCount: poolData.editedClipsCount,
        })
      }
    } catch (err: any) {
      setUploadStatusMsg(`❌ Error: ${err.message}`)
    } finally {
      setUploading(false)
    }
  }

  // Scan Brief with Gemini AI
  async function handleScanBriefWithAI() {
    if (!formData.briefText.trim()) {
      setError('Please enter or paste the campaign brief details first.')
      return
    }

    setAiScanning(true)
    setError('')
    setAiMessage('')

    try {
      const res = await fetch('/api/admin/campaigns/ai-parse-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefText: formData.briefText }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to scan brief.')

      const p = data.parsed || {}
      setFormData((prev) => ({
        ...prev,
        name: p.campaignName || prev.name,
        niche: p.niche || prev.niche,
        readyToPost: p.readyToPost || prev.readyToPost,
        subcampaignGid: p.subcampaignGid || prev.subcampaignGid,
        submissionLink: p.submissionLink || prev.submissionLink,
        whopChannelName: p.whopChannelName || prev.whopChannelName,
        cpm: p.cpm || prev.cpm,
        fixYoutubeMentions: p.fixYoutubeMentions || prev.fixYoutubeMentions,
        enablePendingTasks: p.enablePendingTasks || prev.enablePendingTasks,
        dailyPostLimit: p.dailyPostLimit !== undefined ? p.dailyPostLimit : prev.dailyPostLimit,
        sourceVideoUrls: p.sourceVideoUrls || prev.sourceVideoUrls,
        minViews: p.minViews !== undefined ? p.minViews : prev.minViews,
        minEngagementRate: p.minEngagementRate !== undefined ? p.minEngagementRate : prev.minEngagementRate,
        audioNotes: p.audioNotes || prev.audioNotes,
        clippingStrategies: p.clippingStrategies || prev.clippingStrategies,
        shortDuration: p.shortDuration !== undefined ? p.shortDuration : prev.shortDuration,
        startOffset: p.startOffset !== undefined ? p.startOffset : prev.startOffset,
        volumeMultiplier: p.volumeMultiplier !== undefined ? p.volumeMultiplier : prev.volumeMultiplier,
        hookVideoUrls: p.hookVideoUrls || prev.hookVideoUrls,
        ctaVideoUrls: p.ctaVideoUrls || prev.ctaVideoUrls,
        onScreenTextPool: p.onScreenTextPool || prev.onScreenTextPool,
        singleOnScreenTextOnly: p.singleOnScreenTextOnly || prev.singleOnScreenTextOnly,
        ftcDisclosure: p.ftcDisclosure || prev.ftcDisclosure,
        onScreenTextAiGuide: p.onScreenTextAiGuide || prev.onScreenTextAiGuide,
        onScreenMaxCharacters: p.onScreenMaxCharacters !== undefined ? p.onScreenMaxCharacters : prev.onScreenMaxCharacters,
        titlesAiGuide: p.titlesAiGuide || prev.titlesAiGuide,
        descriptionsAiGuide: p.descriptionsAiGuide || prev.descriptionsAiGuide,
        maxTitleCharacters: p.maxTitleCharacters !== undefined ? p.maxTitleCharacters : prev.maxTitleCharacters,
        predefinedDescription: p.predefinedDescription || prev.predefinedDescription,
        adminGuideLinks: p.adminGuideLinks || prev.adminGuideLinks,
      }))

      setAiMessage(data.notice || '✨ Brief scanned successfully! Form fields populated.')
    } catch (err: any) {
      setError(err.message || 'AI Scan failed.')
    } finally {
      setAiScanning(false)
    }
  }

  // Toggle helpers
  function toggleStrategy(strategy: string) {
    setFormData((prev) => {
      const exists = prev.clippingStrategies.includes(strategy)
      if (exists) {
        if (prev.clippingStrategies.length === 1) return prev
        return { ...prev, clippingStrategies: prev.clippingStrategies.filter((s) => s !== strategy) }
      } else {
        return { ...prev, clippingStrategies: [...prev.clippingStrategies, strategy] }
      }
    })
  }

  function toggleBackgroundStyle(style: string) {
    setFormData((prev) => {
      const exists = prev.backgroundStyles.includes(style)
      if (exists) {
        if (prev.backgroundStyles.length === 1) return prev
        return { ...prev, backgroundStyles: prev.backgroundStyles.filter((s) => s !== style) }
      } else {
        return { ...prev, backgroundStyles: [...prev.backgroundStyles, style] }
      }
    })
  }

  function toggleCornerStyle(style: string) {
    setFormData((prev) => {
      const exists = prev.foregroundCornerStyles.includes(style)
      if (exists) {
        if (prev.foregroundCornerStyles.length === 1) return prev
        return { ...prev, foregroundCornerStyles: prev.foregroundCornerStyles.filter((s) => s !== style) }
      } else {
        return { ...prev, foregroundCornerStyles: [...prev.foregroundCornerStyles, style] }
      }
    })
  }

  function toggleSubtitleCase(c: string) {
    setFormData((prev) => {
      const exists = prev.subtitleTextCases.includes(c)
      if (exists) {
        if (prev.subtitleTextCases.length === 1) return prev
        return { ...prev, subtitleTextCases: prev.subtitleTextCases.filter((x) => x !== c) }
      } else {
        return { ...prev, subtitleTextCases: [...prev.subtitleTextCases, c] }
      }
    })
  }

  function updateBannerField(index: number, field: string, val: any) {
    setFormData((prev) => {
      const updatedBanners = [...prev.banners]
      updatedBanners[index] = { ...updatedBanners[index], [field]: val }
      return { ...prev, banners: updatedBanners }
    })
  }

  // Create Campaign
  async function handleCreateCampaign(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const config = {
      niche: formData.niche.trim(),
      readyToPost: formData.readyToPost,
      subcampaignGid: formData.subcampaignGid.trim(),
      submissionLink: formData.submissionLink.trim(),
      fixYoutubeMentions: formData.fixYoutubeMentions,
      whopChannelName: formData.whopChannelName.trim(),
      cpm: formData.cpm.trim(),
      enablePendingTasks: formData.enablePendingTasks,
      dailyPostLimit: Number(formData.dailyPostLimit) || 45,
      sourceVideoUrls: formData.sourceVideoUrls.trim(),
      specifyTimeRanges: formData.specifyTimeRanges,
      minEngagementRate: Number(formData.minEngagementRate) || 0,
      audioNotes: formData.audioNotes.trim(),
      clippingStrategies: formData.clippingStrategies,
      shortDuration: Number(formData.shortDuration) || 25,
      startOffset: Number(formData.startOffset) || 0,
      volumeMultiplier: Number(formData.volumeMultiplier) || 1.0,
      hookVideoUrls: formData.hookVideoUrls.trim(),
      ctaVideoUrls: formData.ctaVideoUrls.trim(),
      onScreenTextPool: formData.onScreenTextPool.trim(),
      singleOnScreenTextOnly: formData.singleOnScreenTextOnly,
      ftcDisclosure: formData.ftcDisclosure.trim(),
      onScreenTextAiGuide: formData.onScreenTextAiGuide.trim(),
      onScreenMaxCharacters: Number(formData.onScreenMaxCharacters) || 50,
      titlesAiGuide: formData.titlesAiGuide.trim(),
      descriptionsAiGuide: formData.descriptionsAiGuide.trim(),
      maxTitleCharacters: Number(formData.maxTitleCharacters) || 60,
      predefinedDescription: formData.predefinedDescription.trim(),
      useOnlyPredefinedDesc: formData.useOnlyPredefinedDesc,
      linksInDescription: formData.linksInDescription.trim(),
      logoOverlayUrl: formData.logoOverlayUrl.trim(),
      overlayPosition: formData.overlayPosition,
      overlayWidthPercent: Number(formData.overlayWidthPercent) || 60,
      numBottomBanners: Number(formData.numBottomBanners) || 0,
      banners: formData.banners.slice(0, Number(formData.numBottomBanners) || 0),
      onScreenFontName: formData.onScreenFontName.trim(),
      useSameFontForBannersAndSubs: formData.useSameFontForBannersAndSubs,
      onScreenTextColor: formData.onScreenTextColor.trim(),
      onScreenPositionHeightPercent: Number(formData.onScreenPositionHeightPercent) || 27,
      onScreenSizePx: Number(formData.onScreenSizePx) || 64,
      onScreenBackground: formData.onScreenBackground.trim(),
      onScreenStyledWordCount: Number(formData.onScreenStyledWordCount) || 0,
      onScreenStyledWordsColor: formData.onScreenStyledWordsColor.trim(),
      useSameForSpeakingWordHighlight: formData.useSameForSpeakingWordHighlight,
      backgroundStyles: formData.backgroundStyles,
      foregroundCornerStyles: formData.foregroundCornerStyles,
      enableSubtitles: formData.enableSubtitles,
      subtitleFonts: formData.subtitleFonts.trim(),
      subtitleColors: formData.subtitleColors.trim(),
      outlineColors: formData.outlineColors.trim(),
      subtitleWordSize: Number(formData.subtitleWordSize) || 100,
      subtitlesPlacementHeightPercent: Number(formData.subtitlesPlacementHeightPercent) || 80,
      maxWordsPerScreen: Number(formData.maxWordsPerScreen) || 5,
      speakingWordHighlight: formData.speakingWordHighlight.trim(),
      subtitleTextCases: formData.subtitleTextCases,
      adminGuideLinks: formData.adminGuideLinks.trim(),
      useStylingPresets: formData.useStylingPresets,
    }

    try {
      if (editingCampaign) {
        // Edit existing campaign
        const res = await fetch(`/api/admin/campaigns/${editingCampaign.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name.trim(),
            description: formData.audioNotes || null,
            status: formData.status,
            minViews: Number(formData.minViews) || 0,
            config,
            assignAllUsers: formData.assignAllUsers,
            assignedUserIds: formData.assignAllUsers ? [] : formData.assignedUserIds,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update campaign')
        }
      } else {
        // Create new campaign
        const res = await fetch('/api/admin/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name.trim(),
            description: formData.audioNotes || null,
            status: formData.status,
            minViews: Number(formData.minViews) || 0,
            config,
            assignAllUsers: formData.assignAllUsers,
            assignedUserIds: formData.assignAllUsers ? [] : formData.assignedUserIds,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to create campaign')
        }
      }

      await refreshCampaigns()
      setIsCreateOpen(false)
      setEditingCampaign(null)
      setFormData(defaultFormState)
      setAiMessage('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleOpenEdit(c: CampaignItem) {
    const cfg = c.config || {}
    setEditingCampaign(c)
    setError('')
    setAiMessage('')

    setFormData({
      ...defaultFormState,
      name: c.name || '',
      status: c.status || 'active',
      minViews: c.minViews || 0,
      briefText: cfg.briefText || cfg.briefContent || '',
      dailyPostLimit: cfg.dailyPostLimit ?? 45,
      readyToPost: (cfg.readyToPost as 'no' | 'yes') || 'no',
      submissionLink: cfg.submissionLink || '',
      whopChannelName: cfg.whopChannelName || '',
      cpm: cfg.cpm || '',
      subcampaignGid: cfg.subcampaignGid || '',
      niche: cfg.niche || 'Gaming',
      fixYoutubeMentions: (cfg.fixYoutubeMentions as 'no' | 'yes') || 'no',
      enablePendingTasks: (cfg.enablePendingTasks as 'disabled' | 'enabled') || 'disabled',
      sourceVideoUrls: cfg.sourceVideoUrls || '',
      specifyTimeRanges: cfg.specifyTimeRanges ?? false,
      minEngagementRate: cfg.minEngagementRate ?? 0,
      audioNotes: cfg.audioNotes || c.description || '',
      clippingStrategies: Array.isArray(cfg.clippingStrategies) ? cfg.clippingStrategies : ['multi_cut'],
      shortDuration: cfg.shortDuration ?? 25,
      startOffset: cfg.startOffset ?? 0,
      volumeMultiplier: cfg.volumeMultiplier ?? 1.0,
      hookVideoUrls: cfg.hookVideoUrls || '',
      ctaVideoUrls: cfg.ctaVideoUrls || '',
      onScreenTextPool: cfg.onScreenTextPool || '',
      singleOnScreenTextOnly: (cfg.singleOnScreenTextOnly as 'no' | 'yes') || 'no',
      ftcDisclosure: cfg.ftcDisclosure || '',
      onScreenTextAiGuide: cfg.onScreenTextAiGuide || '',
      onScreenMaxCharacters: cfg.onScreenMaxCharacters ?? 50,
      titlesAiGuide: cfg.titlesAiGuide || '',
      descriptionsAiGuide: cfg.descriptionsAiGuide || '',
      maxTitleCharacters: cfg.maxTitleCharacters ?? 60,
      predefinedDescription: cfg.predefinedDescription || '',
      useOnlyPredefinedDesc: cfg.useOnlyPredefinedDesc ?? false,
      linksInDescription: cfg.linksInDescription || '',
      logoOverlayUrl: cfg.logoOverlayUrl || '',
      overlayPosition: cfg.overlayPosition || 'top-left',
      overlayWidthPercent: cfg.overlayWidthPercent ?? 60,
      numBottomBanners: cfg.numBottomBanners ?? 0,
      banners: Array.isArray(cfg.banners) && cfg.banners.length > 0 ? cfg.banners : defaultBanners,
      onScreenFontName: cfg.onScreenFontName || 'Montenegrin Gothic One',
      useSameFontForBannersAndSubs: cfg.useSameFontForBannersAndSubs ?? false,
      onScreenTextColor: cfg.onScreenTextColor || 'white',
      onScreenPositionHeightPercent: cfg.onScreenPositionHeightPercent ?? 27,
      onScreenSizePx: cfg.onScreenSizePx ?? 64,
      onScreenBackground: cfg.onScreenBackground || 'black@0.5',
      onScreenStyledWordCount: cfg.onScreenStyledWordCount ?? 0,
      onScreenStyledWordsColor: cfg.onScreenStyledWordsColor || 'yellow',
      useSameForSpeakingWordHighlight: cfg.useSameForSpeakingWordHighlight ?? false,
      backgroundStyles: Array.isArray(cfg.backgroundStyles) ? cfg.backgroundStyles : ['Split Mirror Blur'],
      foregroundCornerStyles: Array.isArray(cfg.foregroundCornerStyles) ? cfg.foregroundCornerStyles : ['Sharp Rectangular Edges'],
      enableSubtitles: cfg.enableSubtitles || 'Disabled (Fallback to AI Captions)',
      subtitleFonts: cfg.subtitleFonts || 'Montenegrin Gothic One',
      subtitleColors: cfg.subtitleColors || 'white',
      outlineColors: cfg.outlineColors || 'black',
      subtitleWordSize: cfg.subtitleWordSize ?? 100,
      subtitlesPlacementHeightPercent: cfg.subtitlesPlacementHeightPercent ?? 80,
      maxWordsPerScreen: cfg.maxWordsPerScreen ?? 5,
      speakingWordHighlight: cfg.speakingWordHighlight || 'yellow',
      subtitleTextCases: Array.isArray(cfg.subtitleTextCases) ? cfg.subtitleTextCases : ['ALL UPPERCASE'],
      adminGuideLinks: cfg.adminGuideLinks || '',
      useStylingPresets: cfg.useStylingPresets ?? false,
      assignAllUsers: c.assignedUsers.length === 0,
      assignedUserIds: c.assignedUsers.map((u) => u.id),
    })

    setIsCreateOpen(true)
  }

  // Export Campaigns Handler
  function handleExport(format: 'json' | 'csv') {
    setShowExportMenu(false)
    const exportUrl = `/api/admin/campaigns/export?format=${format}`
    const a = document.createElement('a')
    a.href = exportUrl
    a.download = `campaigns_export_${new Date().toISOString().split('T')[0]}.${format}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // Quick Status change
  async function handleStatusChange(id: string, newStatus: string) {
    try {
      const res = await fetch(`/api/admin/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) await refreshCampaigns()
    } catch (err) {
      console.error(err)
    }
  }

  // Delete Campaign
  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this campaign? This action cannot be undone.')) return
    try {
      const res = await fetch(`/api/admin/campaigns/${id}`, { method: 'DELETE' })
      if (res.ok) await refreshCampaigns()
    } catch (err) {
      console.error(err)
    }
  }

  // Save User Access
  async function handleSaveAccess(campaignId: string, userIds: string[]) {
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedUserIds: userIds }),
      })
      if (res.ok) {
        await refreshCampaigns()
        setAccessModalCampaign(null)
      }
    } catch (err) {
      console.error(err)
    }
  }

  const activeCount = campaigns.filter((c) => c.status === 'active').length
  const pausedCount = campaigns.filter((c) => c.status === 'paused').length

  return (
    <div className="space-y-6">
      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Campaigns</span>
            <Megaphone size={16} className="text-primary" />
          </div>
          <p className="text-2xl font-bold text-foreground">{campaigns.length}</p>
          <span className="text-xs text-muted-foreground">Across all clients & niches</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Active</span>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{activeCount}</p>
          <span className="text-xs text-muted-foreground">Available to clippers</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Paused</span>
            <PauseCircle size={16} className="text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{pausedCount}</p>
          <span className="text-xs text-muted-foreground">Inactive campaigns</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Users</span>
            <Users size={16} className="text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-foreground">{allUsers.length}</p>
          <span className="text-xs text-muted-foreground">Eligible for campaign access</span>
        </div>
      </div>

      {/* Controls & Search */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
        <div className="flex gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-muted-foreground w-4 h-4" />
            <input
              type="text"
              placeholder="Search campaigns, niche, whop..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="paused">Paused Only</option>
            <option value="draft">Draft Only</option>
            <option value="ended">Ended Only</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          {/* Export Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-3.5 py-2 border border-border bg-card hover:bg-muted text-foreground rounded-lg text-sm font-medium transition-colors shadow-xs"
            >
              <Download size={15} />
              <span>Export</span>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-1 w-44 bg-card border border-border rounded-lg shadow-lg py-1 z-20">
                <button
                  onClick={() => handleExport('json')}
                  className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-muted flex items-center gap-2"
                >
                  <FileJson size={14} className="text-primary" />
                  <span>Export as JSON</span>
                </button>
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-muted flex items-center gap-2"
                >
                  <FileSpreadsheet size={14} className="text-emerald-500" />
                  <span>Export as CSV</span>
                </button>
              </div>
            )}
          </div>

          {/* Create Button */}
          <button
            onClick={() => {
              setIsCreateOpen(true)
              setError('')
              setAiMessage('')
            }}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus size={16} />
            Create Campaign
          </button>
        </div>
      </div>

      {/* Campaigns Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                <th className="text-left px-5 py-3.5 font-medium">Campaign Identity</th>
                <th className="text-left px-5 py-3.5 font-medium">Niche & Submissions</th>
                <th className="text-left px-5 py-3.5 font-medium">Clipping Strategy</th>
                <th className="text-left px-5 py-3.5 font-medium">Source & Clips</th>
                <th className="text-left px-5 py-3.5 font-medium">User Access</th>
                <th className="text-left px-5 py-3.5 font-medium">Status</th>
                <th className="text-right px-5 py-3.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">
                    No campaigns found. Click &quot;Create Campaign&quot; to configure a new campaign.
                  </td>
                </tr>
              ) : (
                filteredCampaigns.map((c) => {
                  const cfg = c.config || {}
                  const strategies = Array.isArray(cfg.clippingStrategies)
                    ? cfg.clippingStrategies
                    : ['multi_cut']
                  const ss = setupStatuses[c.id]
                  const liveClipCount = ss?.clipCount ?? c.availableClips ?? 0

                  return (
                    <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                      {/* Identity */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
                            <Megaphone size={18} />
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">{c.name}</p>
                            <span className="text-[11px] text-muted-foreground">
                              {cfg.subcampaignGid ? `GID: ${cfg.subcampaignGid}` : 'Main Campaign'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Niche & Whop */}
                      <td className="px-5 py-4">
                        <div className="space-y-1">
                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-foreground">
                            {cfg.niche || 'General'}
                          </span>
                          {cfg.whopChannelName && (
                            <p className="text-xs text-muted-foreground font-mono">
                              {cfg.whopChannelName}
                            </p>
                          )}
                          {cfg.cpm && (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              CPM: {cfg.cpm.startsWith('$') ? cfg.cpm : `$${cfg.cpm}`}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Clipping Strategy */}
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {strategies.map((strat: string) => (
                            <span
                              key={strat}
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary uppercase"
                            >
                              {strat.replace('_', ' ')}
                            </span>
                          ))}
                          <span className="text-[11px] text-muted-foreground block w-full">
                            {cfg.shortDuration || 25}s / offset {cfg.startOffset || 0}s
                          </span>
                        </div>
                      </td>
                      {/* Source & Clip Setup Status */}
                      <td className="px-5 py-4 text-xs">
                        {(() => {
                          const ss = setupStatuses[c.id]
                          if (!ss) return <span className="text-muted-foreground text-[11px]">Loading...</span>

                          return (
                            <div className="space-y-2 min-w-[150px]">
                              {/* Row 1: Source Download Status */}
                              <div>
                                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                                  <span className="font-semibold uppercase tracking-wider text-[9px]">Sources</span>
                                  {ss.sourceCount > 0 && <span className="font-mono text-[10px]">{ss.sourceCount} files</span>}
                                </div>
                                {ss.sourceStatus === 'downloading' && (
                                  <div className="space-y-0.5">
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 animate-pulse">
                                      <Loader2 size={10} className="animate-spin" />
                                      <span>Downloading...</span>
                                    </span>
                                    {ss.progress && (
                                      <p className="text-[10px] text-muted-foreground truncate max-w-[170px]" title={ss.progress}>
                                        {ss.progress}
                                      </p>
                                    )}
                                  </div>
                                )}
                                {(ss.sourceStatus === 'ready' || ss.sourceStatus === 'completed') && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                    <CheckCircle2 size={10} />
                                    <span>Ready ({ss.sourceCount})</span>
                                  </span>
                                )}
                                {ss.sourceStatus === 'error' && (
                                  <div className="space-y-0.5">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-destructive/10 text-destructive border border-destructive/20" title={ss.error || ''}>
                                      <CircleAlert size={10} />
                                      <span>Error</span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleRetriggerSetup(c.id)}
                                      className="text-[10px] text-primary font-semibold hover:underline block"
                                    >
                                      ↻ Retry
                                    </button>
                                  </div>
                                )}
                                {ss.sourceStatus === 'no_sources' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                                    <HardDriveDownload size={10} />
                                    <span>No URLs</span>
                                  </span>
                                )}
                                {ss.sourceStatus === 'pending' && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                      <Clock size={10} />
                                      <span>Pending</span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleRetriggerSetup(c.id)}
                                      className="text-[10px] text-primary font-semibold hover:underline"
                                    >
                                      ▶ Start
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Row 2: Clip Generation Status */}
                              <div className="pt-1.5 border-t border-border/50">
                                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                                  <span className="font-semibold uppercase tracking-wider text-[9px]">Clips</span>
                                  <span className="font-mono text-[10px]">{ss.clipCount ?? c.availableClips ?? 0} ready</span>
                                </div>
                                {ss.clipStatus === 'generating' && (
                                  <div className="space-y-0.5">
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 animate-pulse">
                                      <Loader2 size={10} className="animate-spin" />
                                      <span>Generating...</span>
                                    </span>
                                    {ss.clipProgress && (
                                      <p className="text-[10px] text-muted-foreground truncate max-w-[170px]" title={ss.clipProgress}>
                                        {ss.clipProgress}
                                      </p>
                                    )}
                                  </div>
                                )}
                                {ss.clipStatus === 'queued' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                    <Clock size={10} />
                                    <span>Queued</span>
                                  </span>
                                )}
                                {ss.clipStatus === 'ready' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                    <CheckCircle2 size={10} />
                                    <span>Ready ({ss.clipCount ?? c.availableClips ?? 0})</span>
                                  </span>
                                )}
                                {ss.clipStatus === 'error' && (
                                  <div className="space-y-0.5">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-destructive/10 text-destructive border border-destructive/20" title={ss.clipError || ''}>
                                      <CircleAlert size={10} />
                                      <span>Error</span>
                                    </span>
                                    {ss.clipError && (
                                      <p className="text-[10px] text-destructive truncate max-w-[170px]" title={ss.clipError}>
                                        {ss.clipError}
                                      </p>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleGenerateClips(c.id)}
                                      className="text-[10px] text-primary font-semibold hover:underline block"
                                    >
                                      ↻ Retry Clips
                                    </button>
                                  </div>
                                )}
                                {ss.clipStatus === 'pending' && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                                      <Clock size={10} />
                                      <span>Pending</span>
                                    </span>
                                    {ss.sourceCount > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => handleGenerateClips(c.id)}
                                        className="text-[10px] text-primary font-semibold hover:underline"
                                      >
                                        ▶ Generate
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })()}
                      </td>

                      {/* User Access */}
                      <td className="px-5 py-4">
                        <button
                          onClick={() => setAccessModalCampaign(c)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 text-xs font-semibold transition-colors"
                          title="Manage user access"
                        >
                          <Users size={12} />
                          <span>{c.assignedUsers.length} Users</span>
                        </button>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        <select
                          value={c.status}
                          onChange={(e) => handleStatusChange(c.id, e.target.value)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full border cursor-pointer ${
                            c.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                              : c.status === 'paused'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                              : 'bg-muted text-muted-foreground border-border'
                          }`}
                        >
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="draft">Disabled / Draft</option>
                          <option value="ended">Ended</option>
                        </select>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Available Clips Badge in Admin */}
                          <span
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                            title="Total edited clips ready for submission"
                          >
                            <Film size={12} />
                            <span>{liveClipCount} Clips</span>
                          </span>

                          <button
                            onClick={() => handleOpenUploadModal(c)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors"
                            title="Upload Source Videos or Clips directly to VPS"
                          >
                            <Upload size={13} />
                            <span>Upload</span>
                          </button>

                          <button
                            onClick={() => handleOpenEdit(c)}
                            className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition-colors"
                            title="Edit Campaign"
                          >
                            <Edit size={15} />
                          </button>

                          <button
                            onClick={() => handleDelete(c.id)}
                            className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                            title="Delete Campaign"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE / EDIT CAMPAIGN MODAL (Screenshots 1 through 5) */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-7xl w-full p-4 sm:p-6 space-y-6 max-h-[94vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h3 className="text-xl font-bold text-foreground">
                  {editingCampaign ? 'Edit Campaign' : 'Create Campaign'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {editingCampaign
                    ? `Update settings, clipping strategies, banners, or subtitles for "${editingCampaign.name}"`
                    : 'Configure clipping strategy, submission targets, source video links, bottom banners, subtitles, and styling.'}
                </p>
              </div>
              <button
                onClick={() => {
                  setIsCreateOpen(false)
                  setEditingCampaign(null)
                }}
                className="text-muted-foreground hover:text-foreground text-sm p-1 rounded-md hover:bg-muted"
              >
                ✕
              </button>
            </div>

            {/* Error & Feedback alerts */}
            {error && (
              <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg border border-destructive/20 flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {aiMessage && (
              <div className="p-3 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-500/20 flex items-start gap-2">
                <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                <span>{aiMessage}</span>
              </div>
            )}

            <form onSubmit={handleCreateCampaign} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Left Column: Form Settings (7 cols) */}
                <div className="lg:col-span-7 space-y-6">
                  {/* SECTION: AUTO-FILL SETTINGS FROM BRIEF (GEMINI AI) */}
                  <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Sparkles size={14} />
                  <span>Auto-Fill Settings from Brief (Gemini AI)</span>
                </div>
                <textarea
                  rows={3}
                  placeholder="Paste the campaign brief details here..."
                  value={formData.briefText}
                  onChange={(e) => setFormData({ ...formData, briefText: e.target.value })}
                  className="w-full p-3 bg-background border border-input rounded-lg text-xs font-sans focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  disabled={aiScanning}
                  onClick={handleScanBriefWithAI}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-xs rounded-lg transition-colors disabled:opacity-50"
                >
                  {aiScanning ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  <span>{aiScanning ? 'Scanning with Gemini AI...' : 'Scan Brief with AI'}</span>
                </button>
              </div>

              {/* SECTION 1: IDENTITY */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Megaphone size={14} /> Identity
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Campaign Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. FortuneJack WC"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Niche *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. gaming, crypto, sports"
                      value={formData.niche}
                      onChange={(e) => setFormData({ ...formData, niche: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e: any) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="draft">Disabled / Draft</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Ready to Post</label>
                    <select
                      value={formData.readyToPost}
                      onChange={(e: any) => setFormData({ ...formData, readyToPost: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="no">No (Preview / Test mode)</option>
                      <option value="yes">Yes (Ready to post)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Subcampaign GID / Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Sheet GID or variant name"
                      value={formData.subcampaignGid}
                      onChange={(e) => setFormData({ ...formData, subcampaignGid: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Channel Submission Link (Whop)</label>
                    <input
                      type="text"
                      placeholder="e.g. https://whop.com/..."
                      value={formData.submissionLink}
                      onChange={(e) => setFormData({ ...formData, submissionLink: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 2: RULES & SOURCE MATERIAL */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Film size={14} /> Source Material & Rules
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Fix YouTube Channel Mentions</label>
                    <select
                      value={formData.fixYoutubeMentions}
                      onChange={(e: any) => setFormData({ ...formData, fixYoutubeMentions: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="no">No (Keep plaintext)</option>
                      <option value="yes">Yes (Send Discord alert when views crossed)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Whop Channel Name</label>
                    <input
                      type="text"
                      placeholder="e.g. #clipping-submissions"
                      value={formData.whopChannelName}
                      onChange={(e) => setFormData({ ...formData, whopChannelName: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Campaign CPM ($ / 1,000 Views)</label>
                    <input
                      type="text"
                      placeholder="e.g. 2.50 or $3.00"
                      value={formData.cpm}
                      onChange={(e) => setFormData({ ...formData, cpm: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Enable Pending Tasks Feature</label>
                    <select
                      value={formData.enablePendingTasks}
                      onChange={(e: any) => setFormData({ ...formData, enablePendingTasks: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="disabled">Disabled</option>
                      <option value="enabled">Enabled (Show crossed videos in pending)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Daily Post Limit</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="45"
                      value={formData.dailyPostLimit}
                      onChange={(e) => setFormData({ ...formData, dailyPostLimit: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Drive / YouTube Video URLs</label>
                  <textarea
                    rows={2}
                    placeholder="https://drive.google.com/drive/folders/..., https://youtu.be/..."
                    value={formData.sourceVideoUrls}
                    onChange={(e) => setFormData({ ...formData, sourceVideoUrls: e.target.value })}
                    className="w-full p-2.5 bg-background border border-input rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="specifyTimeRanges"
                    checked={formData.specifyTimeRanges}
                    onChange={(e) => setFormData({ ...formData, specifyTimeRanges: e.target.checked })}
                    className="rounded border-input text-primary focus:ring-ring"
                  />
                  <label htmlFor="specifyTimeRanges" className="text-xs text-foreground cursor-pointer">
                    Specify Time Ranges for Video Downloads
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Min Views Filter</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={formData.minViews}
                      onChange={(e) => setFormData({ ...formData, minViews: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Min Engagement Rate</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={formData.minEngagementRate}
                      onChange={(e) => setFormData({ ...formData, minEngagementRate: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Audio Notes</label>
                  <input
                    type="text"
                    placeholder="e.g. keep original audio, remove music"
                    value={formData.audioNotes}
                    onChange={(e) => setFormData({ ...formData, audioNotes: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              {/* SECTION 3: CLIPPING & TIMING */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Sliders size={14} /> Clipping & Timing
                </h4>
                
                <div>
                  <label className="block text-xs font-medium text-foreground mb-2">
                    Clipping Strategy (Multi-Select)
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {[
                      { key: 'multi_cut', label: 'Multi-Cut' },
                      { key: 'continuous', label: 'Continuous' },
                      { key: 'smart_ai', label: 'Smart AI' },
                    ].map((item) => (
                      <label
                        key={item.key}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                          formData.clippingStrategies.includes(item.key)
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-card border-border text-foreground hover:bg-muted'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.clippingStrategies.includes(item.key)}
                          onChange={() => toggleStrategy(item.key)}
                          className="rounded border-input text-primary"
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Short Duration (seconds)</label>
                    <input
                      type="number"
                      min={5}
                      placeholder="25"
                      value={formData.shortDuration}
                      onChange={(e) => setFormData({ ...formData, shortDuration: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Start Offset (seconds)</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="30"
                      value={formData.startOffset}
                      onChange={(e) => setFormData({ ...formData, startOffset: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Volume Multiplier</label>
                    <input
                      type="number"
                      step="0.1"
                      min={0.1}
                      placeholder="1.0"
                      value={formData.volumeMultiplier}
                      onChange={(e) => setFormData({ ...formData, volumeMultiplier: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Hook Video URLs</label>
                    <textarea
                      rows={2}
                      placeholder="https://drive.google.com/..., https://..."
                      value={formData.hookVideoUrls}
                      onChange={(e) => setFormData({ ...formData, hookVideoUrls: e.target.value })}
                      className="w-full p-2.5 bg-background border border-input rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">CTA Video URLs</label>
                    <textarea
                      rows={2}
                      placeholder="https://drive.google.com/..., https://..."
                      value={formData.ctaVideoUrls}
                      onChange={(e) => setFormData({ ...formData, ctaVideoUrls: e.target.value })}
                      className="w-full p-2.5 bg-background border border-input rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 4: ON-SCREEN TEXT, TITLES & DESCRIPTIONS */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Type size={14} /> Titles, Descriptions & Content AI
                </h4>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">On-Screen Text Pool</label>
                  <textarea
                    rows={2}
                    placeholder="One on-screen text overlay per line. Leave empty if you do NOT want any on-screen text."
                    value={formData.onScreenTextPool}
                    onChange={(e) => setFormData({ ...formData, onScreenTextPool: e.target.value })}
                    className="w-full p-2.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Use Single On-Screen Text Only</label>
                    <select
                      value={formData.singleOnScreenTextOnly}
                      onChange={(e: any) => setFormData({ ...formData, singleOnScreenTextOnly: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="no">No (rotate / generate)</option>
                      <option value="yes">Yes (single static)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">FTC Disclosure</label>
                    <input
                      type="text"
                      placeholder="e.g. #ad #sponsored"
                      value={formData.ftcDisclosure}
                      onChange={(e) => setFormData({ ...formData, ftcDisclosure: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">On-Screen Text AI Guide</label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Write a punchy 1-line hook. Leave empty if you do NOT want on-screen text."
                    value={formData.onScreenTextAiGuide}
                    onChange={(e) => setFormData({ ...formData, onScreenTextAiGuide: e.target.value })}
                    className="w-full p-2.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">On-screen Max Characters</label>
                  <input
                    type="number"
                    min={10}
                    placeholder="50"
                    value={formData.onScreenMaxCharacters}
                    onChange={(e) => setFormData({ ...formData, onScreenMaxCharacters: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Titles / Post Captions AI Guide</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Short curiosity-gap title under 60 chars"
                      value={formData.titlesAiGuide}
                      onChange={(e) => setFormData({ ...formData, titlesAiGuide: e.target.value })}
                      className="w-full p-2.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Descriptions AI Guide</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Include channel link, 5 hashtags, and FTC disclosure"
                      value={formData.descriptionsAiGuide}
                      onChange={(e) => setFormData({ ...formData, descriptionsAiGuide: e.target.value })}
                      className="w-full p-2.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Max Title Characters</label>
                  <input
                    type="number"
                    min={20}
                    max={100}
                    placeholder="60"
                    value={formData.maxTitleCharacters}
                    onChange={(e) => setFormData({ ...formData, maxTitleCharacters: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-foreground">Predefined Description</label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.useOnlyPredefinedDesc}
                        onChange={(e) => setFormData({ ...formData, useOnlyPredefinedDesc: e.target.checked })}
                        className="rounded border-input text-primary"
                      />
                      <span>Use only predefined description</span>
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    placeholder="e.g. Subscribe for more clips! #fun"
                    value={formData.predefinedDescription}
                    onChange={(e) => setFormData({ ...formData, predefinedDescription: e.target.value })}
                    className="w-full p-2.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Links in Description</label>
                  <textarea
                    rows={2}
                    placeholder={`e.g. https://global-link.com OR {"video_name": "https://specific-link.com"}`}
                    value={formData.linksInDescription}
                    onChange={(e) => setFormData({ ...formData, linksInDescription: e.target.value })}
                    className="w-full p-2.5 bg-background border border-input rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              {/* SECTION 5: VISUAL OVERLAY & STYLING (Screenshot 1) */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Image size={14} /> Visual Overlay & Styling
                </h4>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Logo / Overlay URL</label>
                  <input
                    type="text"
                    placeholder="Google Drive image link or direct URL"
                    value={formData.logoOverlayUrl}
                    onChange={(e) => setFormData({ ...formData, logoOverlayUrl: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Overlay Position</label>
                    <select
                      value={formData.overlayPosition}
                      onChange={(e) => setFormData({ ...formData, overlayPosition: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="Top Left">Top Left</option>
                      <option value="Top Center">Top Center</option>
                      <option value="Top Right">Top Right</option>
                      <option value="Bottom Left">Bottom Left</option>
                      <option value="Bottom Center">Bottom Center</option>
                      <option value="Bottom Right">Bottom Right</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Overlay Width (%)</label>
                    <input
                      type="number"
                      min={10}
                      max={100}
                      placeholder="60"
                      value={formData.overlayWidthPercent}
                      onChange={(e) => setFormData({ ...formData, overlayWidthPercent: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 6: BOTTOM BANNERS (Screenshot 2) */}
              <div className="space-y-3 pt-3 border-t border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Palette size={14} /> Bottom Banners
                  </h4>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-foreground">Number of Bottom Banners:</label>
                    <select
                      value={formData.numBottomBanners}
                      onChange={(e) => setFormData({ ...formData, numBottomBanners: Number(e.target.value) })}
                      className="px-2.5 py-1 bg-background border border-input rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value={0}>No Banner</option>
                      <option value={1}>1 Banner</option>
                      <option value={2}>2 Banners</option>
                      <option value={3}>3 Banners</option>
                      <option value={4}>4 Banners</option>
                      <option value={5}>5 Banners</option>
                    </select>
                  </div>
                </div>

                {/* Banner list rendering */}
                {Array.from({ length: formData.numBottomBanners }).map((_, idx) => {
                  const b = formData.banners[idx] || defaultBanners[idx]
                  return (
                    <div key={idx} className="bg-muted/30 border border-border rounded-xl p-3.5 space-y-3">
                      <h5 className="text-xs font-bold text-foreground uppercase tracking-wider">
                        Banner #{idx + 1}
                      </h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-foreground mb-1">Banner #{idx + 1} Text</label>
                          <input
                            type="text"
                            placeholder="e.g. Click link in bio!"
                            value={b.text}
                            onChange={(e) => updateBannerField(idx, 'text', e.target.value)}
                            className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-foreground mb-1">Banner #{idx + 1} Font</label>
                          <input
                            type="text"
                            placeholder="Montenegrin Gothic One"
                            value={b.font}
                            onChange={(e) => updateBannerField(idx, 'font', e.target.value)}
                            className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-foreground mb-1">Text Color</label>
                          <input
                            type="text"
                            placeholder="white"
                            value={b.textColor}
                            onChange={(e) => updateBannerField(idx, 'textColor', e.target.value)}
                            className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-foreground mb-1">Position Height (%)</label>
                          <input
                            type="number"
                            placeholder="85"
                            value={b.positionHeightPercent}
                            onChange={(e) => updateBannerField(idx, 'positionHeightPercent', Number(e.target.value))}
                            className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-foreground mb-1">Font Size (px)</label>
                          <input
                            type="number"
                            placeholder="54"
                            value={b.fontSizePx}
                            onChange={(e) => updateBannerField(idx, 'fontSizePx', Number(e.target.value))}
                            className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-foreground mb-1">Background (color@opacity)</label>
                          <input
                            type="text"
                            placeholder="red@0.8"
                            value={b.background}
                            onChange={(e) => updateBannerField(idx, 'background', e.target.value)}
                            className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-foreground mb-1">Styled Word Count</label>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={b.styledWordCount}
                            onChange={(e) => updateBannerField(idx, 'styledWordCount', Number(e.target.value))}
                            className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-foreground mb-1">Styled Words Color</label>
                          <input
                            type="text"
                            placeholder="yellow"
                            value={b.styledWordsColor}
                            onChange={(e) => updateBannerField(idx, 'styledWordsColor', e.target.value)}
                            className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-foreground mb-1">Show Only in Last Seconds</label>
                          <select
                            value={b.showOnlyInLastSeconds}
                            onChange={(e: any) => updateBannerField(idx, 'showOnlyInLastSeconds', e.target.value)}
                            className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            <option value="No">No (all video)</option>
                            <option value="Yes">Yes (last N seconds)</option>
                          </select>
                        </div>
                      </div>

                      {b.showOnlyInLastSeconds === 'Yes' && (
                        <div>
                          <label className="block text-[11px] font-medium text-foreground mb-1">Duration (Last N sec)</label>
                          <input
                            type="number"
                            min={1}
                            placeholder="5"
                            value={b.lastNDuration}
                            onChange={(e) => updateBannerField(idx, 'lastNDuration', Number(e.target.value))}
                            className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* SECTION 7: ON-SCREEN TEXT STYLING (Screenshot 3) */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Type size={14} /> On-Screen Text Styling
                </h4>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">On-screen text Font Name</label>
                  <input
                    type="text"
                    placeholder="Montenegrin Gothic One"
                    value={formData.onScreenFontName}
                    onChange={(e) => setFormData({ ...formData, onScreenFontName: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="useSameFont"
                    checked={formData.useSameFontForBannersAndSubs}
                    onChange={(e) => setFormData({ ...formData, useSameFontForBannersAndSubs: e.target.checked })}
                    className="rounded border-input text-primary focus:ring-ring"
                  />
                  <label htmlFor="useSameFont" className="text-xs text-foreground cursor-pointer">
                    Use same font for Banners & Subtitles
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">On-screen text Color</label>
                    <input
                      type="text"
                      placeholder="white"
                      value={formData.onScreenTextColor}
                      onChange={(e) => setFormData({ ...formData, onScreenTextColor: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">On-screen text Position (Height %)</label>
                    <input
                      type="number"
                      placeholder="27"
                      value={formData.onScreenPositionHeightPercent}
                      onChange={(e) => setFormData({ ...formData, onScreenPositionHeightPercent: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">On-screen text Size (px)</label>
                    <input
                      type="number"
                      placeholder="64"
                      value={formData.onScreenSizePx}
                      onChange={(e) => setFormData({ ...formData, onScreenSizePx: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">On-screen text Background</label>
                    <input
                      type="text"
                      placeholder="black@0.5"
                      value={formData.onScreenBackground}
                      onChange={(e) => setFormData({ ...formData, onScreenBackground: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">On-screen Styled Word Count</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={formData.onScreenStyledWordCount}
                      onChange={(e) => setFormData({ ...formData, onScreenStyledWordCount: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">On-screen Styled Words Color</label>
                    <input
                      type="text"
                      placeholder="yellow"
                      value={formData.onScreenStyledWordsColor}
                      onChange={(e) => setFormData({ ...formData, onScreenStyledWordsColor: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="useSameForSpeaking"
                    checked={formData.useSameForSpeakingWordHighlight}
                    onChange={(e) => setFormData({ ...formData, useSameForSpeakingWordHighlight: e.target.checked })}
                    className="rounded border-input text-primary focus:ring-ring"
                  />
                  <label htmlFor="useSameForSpeaking" className="text-xs text-foreground cursor-pointer">
                    Use same for Speaking Word Highlight
                  </label>
                </div>
              </div>

              {/* SECTION 8: VIDEO LAYOUT & CANVAS STYLING (Screenshots 3 & 4) */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Film size={14} /> Video Layout & Styling
                </h4>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-2">
                    Background Style (Multi-Select)
                  </label>
                  <div className="flex flex-wrap gap-2.5">
                    {[
                      'Split Mirror Blur',
                      'Vibrant Mirror Blur',
                      'Solid White Canvas',
                      'Solid Black Canvas',
                      'Custom Color',
                      'RGB Monitor',
                    ].map((style) => (
                      <label
                        key={style}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                          formData.backgroundStyles.includes(style)
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-card border-border text-foreground hover:bg-muted'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.backgroundStyles.includes(style)}
                          onChange={() => toggleBackgroundStyle(style)}
                          className="rounded border-input text-primary"
                        />
                        <span>{style}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-2">
                    Foreground Corner Style (Multi-Select)
                  </label>
                  <div className="flex flex-wrap gap-2.5">
                    {[
                      'Sharp Rectangular Edges',
                      'Smooth Rounded Corners',
                      'Soft Feathered Edges',
                      'Rounded with White Border',
                      'Rounded with Drop Shadow',
                    ].map((corner) => (
                      <label
                        key={corner}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                          formData.foregroundCornerStyles.includes(corner)
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-card border-border text-foreground hover:bg-muted'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.foregroundCornerStyles.includes(corner)}
                          onChange={() => toggleCornerStyle(corner)}
                          className="rounded border-input text-primary"
                        />
                        <span>{corner}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* SECTION 9: SUBTITLES (Speech-to-Text / xAI Grok / Whisper) (Screenshot 4) */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Captions size={14} /> Subtitles (Speech-to-Text / xAI Grok)
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Enable Subtitles</label>
                    <select
                      value={formData.enableSubtitles}
                      onChange={(e) => setFormData({ ...formData, enableSubtitles: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="Disabled (Fallback to AI Captions)">Disabled (Fallback to AI Captions)</option>
                      <option value="Enabled (Auto-generated)">Enabled (Auto-generated)</option>
                      <option value="Disabled">Disabled</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Subtitle Fonts</label>
                    <input
                      type="text"
                      placeholder="Montenegrin Gothic One"
                      value={formData.subtitleFonts}
                      onChange={(e) => setFormData({ ...formData, subtitleFonts: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Subtitle Colors</label>
                    <input
                      type="text"
                      placeholder="white"
                      value={formData.subtitleColors}
                      onChange={(e) => setFormData({ ...formData, subtitleColors: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Outline Colors</label>
                    <input
                      type="text"
                      placeholder="black"
                      value={formData.outlineColors}
                      onChange={(e) => setFormData({ ...formData, outlineColors: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Subtitle Word Size(s)</label>
                    <input
                      type="number"
                      placeholder="100"
                      value={formData.subtitleWordSize}
                      onChange={(e) => setFormData({ ...formData, subtitleWordSize: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Placement Height (%)</label>
                    <input
                      type="number"
                      placeholder="80"
                      value={formData.subtitlesPlacementHeightPercent}
                      onChange={(e) => setFormData({ ...formData, subtitlesPlacementHeightPercent: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Max Words Per Screen</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      placeholder="5"
                      value={formData.maxWordsPerScreen}
                      onChange={(e) => setFormData({ ...formData, maxWordsPerScreen: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Speaking Word Highlight</label>
                    <input
                      type="text"
                      placeholder="yellow"
                      value={formData.speakingWordHighlight}
                      onChange={(e) => setFormData({ ...formData, speakingWordHighlight: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-2">
                    Subtitle Text Case (Multi-Select)
                  </label>
                  <div className="flex flex-wrap gap-2.5">
                    {['ALL UPPERCASE', 'all lowercase', 'Normal Text'].map((c) => (
                      <label
                        key={c}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                          formData.subtitleTextCases.includes(c)
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-card border-border text-foreground hover:bg-muted'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.subtitleTextCases.includes(c)}
                          onChange={() => toggleSubtitleCase(c)}
                          className="rounded border-input text-primary"
                        />
                        <span>{c}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* SECTION 10: ADMIN'S GUIDE LINKS & STYLING PRESETS (Screenshot 5) */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <LinkIcon size={14} /> Admin Guidelines & Presets
                </h4>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Admin&apos;s Guide Links</label>
                  <input
                    type="text"
                    placeholder="e.g. Title:https://docs.google.com/...,Title2:https://docs.google.com/..."
                    value={formData.adminGuideLinks}
                    onChange={(e) => setFormData({ ...formData, adminGuideLinks: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-[11px] text-muted-foreground block mt-1">
                    Guideline documents will be displayed to users in their Campaign Catalog.
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="useStylingPresets"
                    checked={formData.useStylingPresets}
                    onChange={(e) => setFormData({ ...formData, useStylingPresets: e.target.checked })}
                    className="rounded border-input text-primary focus:ring-ring"
                  />
                  <label htmlFor="useStylingPresets" className="text-xs text-foreground cursor-pointer font-medium">
                    Use Styling Presets
                  </label>
                </div>
              </div>

              {/* USER ACCESS */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Users size={14} /> User Access
                </h4>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="assignAllUsers"
                    checked={formData.assignAllUsers}
                    onChange={(e) => setFormData({ ...formData, assignAllUsers: e.target.checked })}
                    className="rounded border-input text-primary focus:ring-ring"
                  />
                  <label htmlFor="assignAllUsers" className="text-xs text-foreground cursor-pointer font-medium">
                    Assign to All Active Users Automatically
                  </label>
                </div>
              </div>
            </div>

            {/* Right Column: Sticky Live 9:16 Mobile Phone Mockup (5 cols) */}
            <div className="lg:col-span-5 lg:sticky lg:top-0 space-y-4 pt-1">
              <CampaignPreviewMockup formData={formData} />
            </div>
          </div>

              {/* Modal Buttons (Screenshot 5 - Save Campaign) */}
              <div className="flex justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {loading
                    ? (editingCampaign ? 'Updating Campaign...' : 'Saving Campaign...')
                    : (editingCampaign ? 'Update Campaign' : 'Save Campaign')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Access Modal */}
      {accessModalCampaign && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-foreground">
              Manage Access: {accessModalCampaign.name}
            </h3>
            <p className="text-xs text-muted-foreground">
              Select which registered users can view and run automations for this campaign.
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto border border-border rounded-lg p-3">
              {allUsers.length === 0 ? (
                <p className="text-xs text-muted-foreground">No users available.</p>
              ) : (
                allUsers.map((u) => {
                  const hasAccess = accessModalCampaign.assignedUsers.some((au) => au.id === u.id)
                  return (
                    <label key={u.id} className="flex items-center gap-2.5 p-1.5 hover:bg-muted/40 rounded cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        defaultChecked={hasAccess}
                        onChange={(e) => {
                          const currentIds = accessModalCampaign.assignedUsers.map((au) => au.id)
                          const updated = e.target.checked
                            ? [...currentIds, u.id]
                            : currentIds.filter((id) => id !== u.id)
                          setAccessModalCampaign({
                            ...accessModalCampaign,
                            assignedUsers: allUsers.filter((usr) => updated.includes(usr.id)),
                          })
                        }}
                        className="rounded border-input text-primary"
                      />
                      <div>
                        <p className="font-semibold text-foreground">{u.name || 'Unnamed'}</p>
                        <p className="text-[11px] text-muted-foreground">{u.email}</p>
                      </div>
                    </label>
                  )
                })
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setAccessModalCampaign(null)}
                className="px-3.5 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  handleSaveAccess(
                    accessModalCampaign.id,
                    accessModalCampaign.assignedUsers.map((u) => u.id)
                  )
                }
                className="px-3.5 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90"
              >
                Save Permissions
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UPLOAD CLIPS TO VPS MODAL */}
      {uploadModalCampaign && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Upload size={18} className="text-purple-500" />
                  Upload Videos to VPS Storage
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Campaign: <span className="font-semibold text-foreground">{uploadModalCampaign.name}</span>
                </p>
              </div>
              <button
                onClick={() => setUploadModalCampaign(null)}
                className="p-1 rounded-md text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>

            {/* Current Pool Status */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/40 rounded-xl border border-border/60 text-xs">
              <div>
                <span className="text-muted-foreground block text-[11px]">Source Videos on VPS:</span>
                <span className="text-sm font-bold text-foreground">
                  {poolStatus ? poolStatus.sourceFilesCount : '...'} videos
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Edited Clips Ready:</span>
                <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
                  {poolStatus ? `${poolStatus.editedClipsCount} / 300` : '...'}
                </span>
              </div>
            </div>

            <form onSubmit={handleUploadFiles} className="space-y-4">
              {/* Target Type Selector */}
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Upload Destination
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      uploadTargetType === 'sources'
                        ? 'border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold'
                        : 'border-border hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    <input
                      type="radio"
                      name="targetType"
                      value="sources"
                      checked={uploadTargetType === 'sources'}
                      onChange={() => setUploadTargetType('sources')}
                      className="hidden"
                    />
                    <span>Raw Source Videos</span>
                  </label>
                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      uploadTargetType === 'clips'
                        ? 'border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold'
                        : 'border-border hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    <input
                      type="radio"
                      name="targetType"
                      value="clips"
                      checked={uploadTargetType === 'clips'}
                      onChange={() => setUploadTargetType('clips')}
                      className="hidden"
                    />
                    <span>Ready Edited Clips</span>
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {uploadTargetType === 'sources'
                    ? 'Source videos will be cut & styled by the continuous editing engine.'
                    : 'Ready clips directly count towards the 300 clips pool and are ready to post.'}
                </p>
              </div>

              {/* File Input */}
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Select Video Files (MP4, MOV, WebM)
                </label>
                <input
                  type="file"
                  multiple
                  accept="video/mp4,video/quicktime,video/webm"
                  onChange={(e) => setUploadFiles(e.target.files)}
                  className="w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-purple-500/10 file:text-purple-600 dark:file:text-purple-400 hover:file:bg-purple-500/20 border border-border rounded-lg p-2 bg-background"
                />
                {uploadFiles && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                    Selected {uploadFiles.length} file(s)
                  </p>
                )}
              </div>

              {uploadStatusMsg && (
                <div className={`p-2.5 rounded-lg text-xs ${
                  uploadStatusMsg.startsWith('✅')
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                    : 'bg-destructive/10 text-destructive border border-destructive/20'
                }`}>
                  {uploadStatusMsg}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setUploadModalCampaign(null)}
                  disabled={uploading}
                  className="px-3.5 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFiles || uploadFiles.length === 0}
                  className="px-4 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                >
                  {uploading ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Uploading to VPS...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={13} />
                      <span>Upload Files</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

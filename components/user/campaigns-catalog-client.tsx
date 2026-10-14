'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Megaphone, Eye, Zap, Search, CheckCircle2,
  AlertCircle, ArrowRight, FileText, Sparkles, Clock, ExternalLink, Film
} from 'lucide-react'

interface UserCampaignItem {
  id: string
  name: string
  description: string | null
  status: 'active' | 'paused' | 'ended' | 'draft'
  minViews: number | null
  config: any
  createdAt: string
}

interface CampaignsCatalogClientProps {
  initialCampaigns: UserCampaignItem[]
}

export function CampaignsCatalogClient({ initialCampaigns }: CampaignsCatalogClientProps) {
  const [campaigns] = useState<UserCampaignItem[]>(initialCampaigns)
  const [search, setSearch] = useState('')
  const [selectedCampaign, setSelectedCampaign] = useState<UserCampaignItem | null>(null)

  const filtered = campaigns.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.description && c.description.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Search Bar */}
      <div className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 text-muted-foreground w-4 h-4" />
          <input
            type="text"
            placeholder="Search campaigns by name or guidelines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Campaigns Grid */}
      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <Megaphone size={32} className="mx-auto text-muted-foreground mb-3 opacity-50" />
          <p className="font-medium text-foreground">No Campaigns Available</p>
          <p className="text-xs text-muted-foreground mt-1">
            Your administrator has not granted you access to any active campaigns yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="bg-card border border-border rounded-xl p-5 flex flex-col justify-between shadow-xs hover:border-primary/50 transition-all space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
                      <Megaphone size={16} />
                    </div>
                    <div>
                      <h3 className="font-bold text-foreground text-base leading-snug">{c.name}</h3>
                      <span className="text-[11px] text-muted-foreground">
                        Added {new Date(c.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${
                      c.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                    }`}
                  >
                    {c.status === 'active' ? 'Active' : 'Paused'}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed mt-2">
                  {c.description || 'No detailed instructions provided.'}
                </p>

                <div className="flex flex-wrap items-center gap-2 mt-3.5">
                  {/* Available Clips Badge */}
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold border border-blue-500/20">
                    <Film size={13} />
                    <span>{(c as any).availableClips ?? 0} Clips Ready</span>
                  </div>

                  {/* Min Views Requirement Badge */}
                  {c.minViews && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 text-xs font-semibold border border-purple-500/20">
                      <Eye size={13} />
                      <span>Goal: {c.minViews.toLocaleString()} Views</span>
                    </div>
                  )}
                </div>

                {/* Custom parameters preview */}
                {c.config && Object.keys(c.config).length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mt-3 pt-3 border-t border-border/60">
                    {Object.entries(c.config).slice(0, 3).map(([k, v]: any) => (
                      <span
                        key={k}
                        className="text-[10px] bg-muted/60 px-2 py-0.5 rounded font-mono text-foreground"
                      >
                        {k}: {String(v)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-border flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedCampaign(c)}
                  className="flex-1 text-center py-2 px-3 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                >
                  View Details
                </button>
                <Link
                  href={`/run-automation?campaignId=${c.id}`}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-xs"
                >
                  <Zap size={13} /> Run Automation
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Campaign Details Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
                  <Megaphone size={16} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">{selectedCampaign.name}</h3>
                  <span className="text-[11px] text-muted-foreground capitalize">
                    Status: {selectedCampaign.status}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedCampaign(null)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Campaign Guidelines & Instructions
              </span>
              <p className="text-xs text-muted-foreground whitespace-pre-line bg-muted/30 p-3 rounded-lg leading-relaxed">
                {selectedCampaign.description || 'No special instructions.'}
              </p>
            </div>

            {/* Threshold info */}
            {selectedCampaign.minViews && (
              <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs flex items-center gap-2 text-purple-700 dark:text-purple-300">
                <Eye size={16} />
                <div>
                  <span className="font-bold">Pending Task Threshold: {selectedCampaign.minViews.toLocaleString()} views.</span>
                  <p className="text-[11px] opacity-80">
                    When your uploaded video hits this view count, a pending task will be automatically created in your dashboard for review & submission.
                  </p>
                </div>
              </div>
            )}

            {/* Custom Rules */}
            {selectedCampaign.config && Object.keys(selectedCampaign.config).length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Campaign Parameters & Rules
                </span>
                <div className="border border-border rounded-lg divide-y divide-border text-xs">
                  {Object.entries(selectedCampaign.config).map(([k, v]: any) => (
                    <div key={k} className="p-2.5 flex items-center justify-between">
                      <span className="font-mono text-muted-foreground">{k}</span>
                      <span className="font-semibold text-foreground">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Admin Guide Links */}
            {selectedCampaign.config?.adminGuideLinks && (
              <div className="space-y-1.5 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs">
                <span className="font-bold text-blue-600 dark:text-blue-400 block">
                  Campaign Guide Documents & Links
                </span>
                <div className="space-y-1">
                  {selectedCampaign.config.adminGuideLinks
                    .split(',')
                    .map((item: string, i: number) => {
                      const trimmed = item.trim()
                      if (!trimmed) return null
                      const [title, ...urlParts] = trimmed.includes('http')
                        ? trimmed.split(/(?=https?:\/\/)/)
                        : [trimmed, '']
                      const cleanTitle = title.replace(/:$/, '').trim()
                      const cleanUrl = urlParts.join('') || cleanTitle

                      return (
                        <a
                          key={i}
                          href={cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-primary hover:underline font-medium"
                        >
                          <ExternalLink size={12} />
                          <span>{cleanTitle || 'Open Guide Document'}</span>
                        </a>
                      )
                    })}
                </div>
              </div>
            )}


            <div className="flex gap-2 justify-end pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setSelectedCampaign(null)}
                className="px-4 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-muted"
              >
                Close
              </button>
              <Link
                href={`/run-automation?campaignId=${selectedCampaign.id}`}
                className="inline-flex items-center gap-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90"
              >
                <Zap size={13} /> Select for Automation
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

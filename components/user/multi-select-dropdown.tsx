'use client'

import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, X, Search } from 'lucide-react'

interface MultiSelectDropdownProps {
  label?: string
  placeholder?: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  className?: string
  maxDisplay?: number
}

export function MultiSelectDropdown({
  label,
  placeholder = 'All',
  options,
  selected,
  onChange,
  className = '',
  maxDisplay = 1,
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const filteredOptions = options.filter((opt) =>
    opt.toLowerCase().includes(search.trim().toLowerCase())
  )

  const toggleOption = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((item) => item !== opt))
    } else {
      onChange([...selected, opt])
    }
  }

  const handleSelectAll = () => {
    onChange([...options])
  }

  const handleClearAll = () => {
    onChange([])
  }

  // Display text on the button
  const getDisplayText = () => {
    if (selected.length === 0) {
      return placeholder
    }
    if (selected.length <= maxDisplay) {
      return selected.join(', ')
    }
    return `${selected.length} Selected`
  }

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <div className="flex items-center gap-1.5">
        {label && (
          <span className="text-xs font-medium text-[var(--text-muted)] whitespace-nowrap">
            {label}:
          </span>
        )}
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`px-3 py-1.5 rounded-xl neu-pressed text-xs font-semibold flex items-center justify-between gap-2 transition-all min-w-[130px] max-w-[220px] ${
            selected.length > 0
              ? 'text-[var(--primary)] border border-primary/30'
              : 'text-[var(--text-primary)]'
          }`}
          title={selected.length > 0 ? selected.join(', ') : placeholder}
        >
          <span className="truncate text-left">{getDisplayText()}</span>
          <div className="flex items-center gap-1 shrink-0">
            {selected.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                {selected.length}
              </span>
            )}
            <ChevronDown
              size={13}
              className={`text-[var(--text-muted)] transition-transform duration-150 ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-64 bg-card border border-border rounded-xl shadow-xl z-50 p-2 space-y-2 animate-in fade-in zoom-in-95 duration-100">
          {/* Quick Actions Header */}
          <div className="flex items-center justify-between px-1.5 pt-0.5 text-[11px]">
            <span className="font-semibold text-muted-foreground">
              {selected.length} of {options.length} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-primary hover:underline font-semibold"
              >
                Select all
              </button>
              <span className="text-muted-foreground">·</span>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Search box if options > 5 */}
          {options.length > 5 && (
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-7 pr-2 py-1 text-xs bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
              />
            </div>
          )}

          {/* Options List */}
          <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                No matching options
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isChecked = selected.includes(opt)
                return (
                  <label
                    key={opt}
                    onClick={(e) => {
                      e.preventDefault()
                      toggleOption(opt)
                    }}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors ${
                      isChecked
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isChecked
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'border-border bg-background'
                      }`}
                    >
                      {isChecked && <Check size={10} strokeWidth={3} />}
                    </div>
                    <span className="truncate font-mono text-[11px]">{opt}</span>
                  </label>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

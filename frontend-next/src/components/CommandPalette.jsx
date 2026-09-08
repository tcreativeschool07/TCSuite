'use client'

// Command palette — ⌘K / Ctrl-K anywhere inside the shell.
//
// Three kinds of result, all served by endpoints the app already uses:
//   • Pages     — the sidebar destinations, filtered by name
//   • Students  — GET /students/?search=   (debounced, first 8)
//   • Receipt   — GET /fees/records/lookup-receipt/?receipt=  when the query is
//                 a receipt-shaped number (4 or 8 digits)
// Arrow keys move, Enter opens, Esc closes. No new dependencies.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { getStudents } from '../api/studentsApi'
import { lookupReceipt } from '../api/feesApi'
import { Icon, Spinner } from './icons'

const PAGES = [
  { to: '/',                  icon: 'home',       label: 'Dashboard' },
  { to: '/students',          icon: 'students',   label: 'Students' },
  { to: '/students/new',      icon: 'plus',       label: 'Enrol a student' },
  { to: '/classes',           icon: 'building',   label: 'Classes' },
  { to: '/fees',              icon: 'chart',      label: 'Fee dashboard' },
  { to: '/fees/records',      icon: 'card',       label: 'Fee records' },
  { to: '/fees/structures',   icon: 'calculator', label: 'Fee structures' },
  { to: '/fees/defaulters',   icon: 'report',     label: 'Fee defaulters' },
  { to: '/balance-sheet',     icon: 'report',     label: 'Balance sheet' },
  { to: '/academic-years',    icon: 'calendar',   label: 'Academic years' },
  { to: '/misc-charges',      icon: 'plus',       label: 'Misc. charges' },
  { to: '/charge-categories', icon: 'tag',        label: 'Charge categories' },
]

const isReceiptShaped = (q) => /^\d{4}$|^\d{8}$/.test(q.trim())
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return { open, setOpen }
}

export function SearchTrigger({ onClick }) {
  const [mac, setMac] = useState(false)
  useEffect(() => { setMac(isMac()) }, [])
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden md:inline-flex items-center gap-2 h-9 pl-3 pr-2 rounded-control border border-edge bg-surface text-[13px] text-ink-3 hover:text-ink-2 hover:border-ink-3/40 transition-colors duration-120 w-72 shadow-[var(--shadow-1)]"
      aria-label="Search students, receipts and pages"
    >
      <Icon name="search" size={15} stroke={1.75} />
      <span className="flex-1 text-left truncate">Search students, receipts…</span>
      <span className="flex items-center gap-0.5">
        <kbd className="kbd">{mac ? '⌘' : 'Ctrl'}</kbd>
        <kbd className="kbd">K</kbd>
      </span>
    </button>
  )
}

export default function CommandPalette({ open, onClose }) {
  const router = useRouter()
  const reduced = useReducedMotion()
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [query, setQuery] = useState('')
  const [students, setStudents] = useState([])
  const [receipt, setReceipt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState(0)

  // Reset on open; focus the field once the panel has mounted.
  useEffect(() => {
    if (!open) return
    setQuery(''); setStudents([]); setReceipt(null); setCursor(0)
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])

  // Debounced remote lookups. Latest query wins; stale responses are dropped.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) { setStudents([]); setReceipt(null); setBusy(false); return }
    let alive = true
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const [studRes, recRes] = await Promise.all([
          getStudents({ search: q, page_size: 8 }),
          isReceiptShaped(q) ? lookupReceipt(q).catch(() => null) : Promise.resolve(null),
        ])
        if (!alive) return
        const rows = studRes.data.results ?? studRes.data
        setStudents(Array.isArray(rows) ? rows.slice(0, 8) : [])
        setReceipt(recRes?.data ?? null)
      } catch {
        if (alive) { setStudents([]); setReceipt(null) }
      } finally {
        if (alive) setBusy(false)
      }
    }, 160)
    return () => { alive = false; clearTimeout(t) }
  }, [query, open])

  const pages = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return PAGES
    return PAGES.filter((p) => p.label.toLowerCase().includes(q))
  }, [query])

  // One flat, ordered list drives keyboard navigation across groups.
  const items = useMemo(() => {
    const out = []
    if (receipt) {
      out.push({
        kind: 'receipt', key: `r-${receipt.id}`, icon: 'card',
        label: `Receipt ${receipt.receipt_display || receipt.receipt_no}`,
        sub: `${receipt.student_name ?? receipt.student?.student_name ?? ''} · ${receipt.month_name} ${receipt.year} · ${receipt.status}`,
        to: `/fees/records?search=${encodeURIComponent(receipt.receipt_no)}`,
      })
    }
    students.forEach((s) => out.push({
      kind: 'student', key: `s-${s.id}`, icon: 'students',
      label: s.student_name,
      sub: `#${s.admission_no} · ${s.current_class || 'no class'}${s.withdrawn === 'yes' ? ' · withdrawn' : ''}`,
      to: `/students/${s.id}`,
    }))
    pages.forEach((p) => out.push({ kind: 'page', key: `p-${p.to}`, icon: p.icon, label: p.label, to: p.to }))
    return out
  }, [receipt, students, pages])

  useEffect(() => { setCursor(0) }, [items.length, query])

  const go = useCallback((item) => {
    if (!item) return
    onClose()
    router.push(item.to)
  }, [onClose, router])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[cursor]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    const el = listRef.current?.querySelector('[aria-selected="true"]')
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor])

  const dur = reduced ? 0 : 0.16
  let lastKind = null

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-[rgba(18,24,19,0.45)] dark:bg-[rgba(0,0,0,0.6)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: dur }}
            onClick={onClose}
          />
          <motion.div
            role="dialog" aria-modal="true" aria-label="Search"
            className="panel shadow-overlay relative w-full max-w-[600px] overflow-hidden"
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -6 }}
            transition={{ duration: dur, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-3 px-4 h-14 border-b border-rule">
              <span className="text-ink-3">
                {busy ? <Spinner className="w-4 h-4" /> : <Icon name="search" size={18} stroke={1.75} />}
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search students by name or admission no., a receipt number, or a page…"
                className="flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-3 outline-none focus-visible:[box-shadow:none]"
                aria-label="Search"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="kbd">Esc</kbd>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2" role="listbox">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center text-[13.5px] text-ink-3">
                  {query.trim().length < 2 ? 'Type to search.' : busy ? 'Searching…' : 'Nothing matches.'}
                </p>
              ) : items.map((item, i) => {
                const heading = item.kind !== lastKind
                  ? { receipt: 'Receipt', student: 'Students', page: 'Pages' }[item.kind]
                  : null
                lastKind = item.kind
                return (
                  <div key={item.key}>
                    {heading && <p className="palette-group">{heading}</p>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === cursor}
                      className="palette-item"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(item)}
                    >
                      <span className="w-7 h-7 rounded-md bg-surface-sunken flex items-center justify-center shrink-0 text-ink-2">
                        <Icon name={item.icon} size={15} stroke={1.75} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] truncate">{item.label}</span>
                        {item.sub && <span className="palette-sub block truncate num">{item.sub}</span>}
                      </span>
                      {i === cursor && <kbd className="kbd">↵</kbd>}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-4 px-4 h-10 border-t border-rule text-[12px] text-ink-3">
              <span className="flex items-center gap-1"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> move</span>
              <span className="flex items-center gap-1"><kbd className="kbd">↵</kbd> open</span>
              <span className="flex items-center gap-1"><kbd className="kbd">Esc</kbd> close</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

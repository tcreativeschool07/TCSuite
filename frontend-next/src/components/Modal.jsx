'use client'

// PARITY: same prop contract as the old Modal ({ open, onClose, title, children,
// size: 'sm'|'md'|'lg'|'xl' }) and the same close behaviors (Esc, backdrop
// click, X button). New in the redesign: no backdrop blur,
// overlay shadow instead of glass, 160ms fade + 0.98→1 scale (reversed on
// close), focus trapped while open and restored on close.
import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Icon } from './icons'

const sizeClass = {
  sm: 'max-w-[400px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[680px]',
  xl: 'max-w-[860px]',
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, children, size = 'md' }) {
  const panelRef = useRef(null)
  const restoreRef = useRef(null)
  const reduced = useReducedMotion()

  // Esc closes — same as the old component.
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Focus trap: remember the opener, move focus in, restore on close.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement
    const t = setTimeout(() => {
      const first = panelRef.current?.querySelector(FOCUSABLE)
      ;(first ?? panelRef.current)?.focus()
    }, 0)
    return () => {
      clearTimeout(t)
      restoreRef.current?.focus?.()
    }
  }, [open])

  const trapTab = (e) => {
    if (e.key !== 'Tab' || !panelRef.current) return
    const nodes = Array.from(panelRef.current.querySelectorAll(FOCUSABLE))
    if (nodes.length === 0) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus()
    }
  }

  const dur = reduced ? 0 : 0.16

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Overlay: flat dim, no blur */}
          <motion.div
            className="absolute inset-0 bg-[rgba(18,24,19,0.45)] dark:bg-[rgba(0,0,0,0.6)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            onKeyDown={trapTab}
            className={`panel shadow-overlay relative w-full ${sizeClass[size] ?? sizeClass.md} max-h-[90vh] flex flex-col overflow-hidden`}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: dur * 1.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
              <h2 className="text-[18px] font-semibold text-ink">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="btn btn-ghost btn-sm -mr-2 px-2"
              >
                <Icon name="close" size={18} stroke={1.8} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

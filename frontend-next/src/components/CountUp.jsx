'use client'

// Dashboard KPI count-up: 500ms ease-out from the previously shown value
// to the new one. Reduced-motion users see the final value immediately.
//
// The animation must be restartable: React StrictMode mounts, tears down and
// re-mounts effects in dev, and `value` also changes when a page refetches. A
// one-shot ref guard would swallow the real run and leave the tile stuck at 0,
// so instead we always animate and remember where the last run finished.
import { useEffect, useRef, useState } from 'react'

export default function CountUp({ value, format = (v) => v.toLocaleString(), duration = 500 }) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    if (value == null || !Number.isFinite(Number(value))) return
    const target = Number(value)

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || duration <= 0) {
      fromRef.current = target
      setDisplay(target)
      return
    }

    const from = fromRef.current
    let raf
    const start = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(from + (target - from) * eased)
      if (p < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  if (value == null || !Number.isFinite(Number(value))) return '—'
  return format(Math.round(display))
}

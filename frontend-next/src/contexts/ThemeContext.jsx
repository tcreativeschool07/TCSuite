'use client'

// PARITY: same behavior as frontend/src/contexts/ThemeContext.jsx — class
// strategy on <html>, localStorage key 'theme', prefers-color-scheme default.
// The initial value is read from the DOM after mount (the no-flash script in
// app/layout.jsx has already applied the class before hydration), instead of
// from localStorage in the useState initializer, because that initializer also
// runs during SSR in Next.js.
import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

const ThemeContext = createContext()

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(false)
  const firstRun = useRef(true)

  // Sync from the class the no-flash script set before hydration.
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    const root = document.documentElement
    if (dark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  // Crossfade the whole page when the browser supports View Transitions and the
  // user hasn't asked for reduced motion; otherwise the plain toggle. Behaviour
  // (class on <html>, localStorage key) is unchanged either way.
  const toggle = () => {
    const flip = () => setDark(prev => !prev)
    const reduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduced && typeof document !== 'undefined' && document.startViewTransition) {
      document.startViewTransition(() => flushSync(flip))
    } else {
      flip()
    }
  }

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)

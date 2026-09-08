'use client'

// Login — standalone, always dark, the app's one moment of theater.
// Submit handler, error handling, loading verb, and redirects are identical to
// the old pages/Login.jsx. The whole page is wrapped in a `dark` class scope so
// the standard token components render with dark values regardless of theme.
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import toast from 'react-hot-toast'
import { useAuth } from '@/src/contexts/AuthContext'
import { Spinner } from '@/src/components/icons'

// Three.js is code-split to this route only. The static vignette below
// doubles as the loading and no-WebGL/reduced-motion fallback — the form never
// waits for the scene.
const LoginScene = dynamic(() => import('@/src/three/LoginScene'), { ssr: false })

export default function Login() {
  const { login, user } = useAuth()
  const router = useRouter()
  const [form, setForm]       = useState({ username: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [scene, setScene]     = useState(false)

  // PARITY: old page rendered <Navigate to="/" replace /> when already authed.
  useEffect(() => {
    if (user && !loading) router.replace('/')
  }, [user, loading, router])

  // Enable the 3D scene only when WebGL is available and motion is welcome.
  useEffect(() => {
    try {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      if (!reduced && gl) setScene(true)
    } catch { /* static fallback stays */ }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(form.username, form.password)
      toast.success('Welcome back!')
      router.push('/')
    } catch (err) {
      // A throttled login returns DRF's "Request was throttled. Expected
      // available in 3599 seconds." — true, but not something to show a person.
      let msg
      if (err.response?.status === 429) {
        const seconds = Number(String(err.response?.data?.detail ?? '')
          .match(/(\d+)\s*second/)?.[1])
        const minutes = Number.isFinite(seconds) ? Math.ceil(seconds / 60) : null
        msg = minutes
          ? `Too many sign-in attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
          : 'Too many sign-in attempts. Please wait a few minutes and try again.'
      } else {
        msg = err.response?.data?.detail || 'Invalid credentials'
      }
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dark relative min-h-screen overflow-hidden login-vignette">
      {/* Scene behind everything */}
      {scene && (
        <div className="absolute inset-0 login-scene-in">
          <LoginScene />
        </div>
      )}

      {/* Foreground column */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-[400px] login-form-in">
          {/* Wordmark */}
          <div className="text-center mb-8">
            <h1 className="font-display text-[34px] font-medium text-[#E8EAE5] leading-tight">
              The Creative School
            </h1>
            <p className="text-[13px] text-[#7A8077] mt-1">Management system</p>
          </div>

          {/* Form panel — solid dark surface, no glass */}
          <div className="panel shadow-overlay p-8">
            <h2 className="text-[16px] font-semibold text-ink mb-1">Sign in</h2>
            <p className="text-[13px] text-ink-3 mb-6">Enter your credentials to continue.</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="label" htmlFor="login-username">Username</label>
                <input
                  id="login-username"
                  className="input"
                  type="text"
                  placeholder="admin"
                  autoComplete="username"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  className="input"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full"
              >
                {loading ? (<><Spinner /> Signing in…</>) : 'Sign in'}
              </button>
            </form>
          </div>

          <p className="text-center text-[12px] text-[#7A8077] mt-6">
            Staff and admin access only
          </p>
        </div>
      </div>
    </div>
  )
}

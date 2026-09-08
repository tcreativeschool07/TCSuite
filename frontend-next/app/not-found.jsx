'use client'

// PARITY: the old app's catch-all route was <Navigate to="/" replace /> inside
// the protected shell. Unknown URLs still land on the dashboard (the (app)
// guard then handles auth).
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function NotFound() {
  const router = useRouter()
  useEffect(() => { router.replace('/') }, [router])
  return null
}

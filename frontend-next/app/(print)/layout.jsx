'use client'

// PARITY: the two invoice routes were wrapped in ProtectedRoute in the old app.
// Same guard here — but no app shell and no dark-mode styling: these are
// working print documents.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/src/contexts/AuthContext'
import { PageLoader } from '@/src/components/Skeleton'

export default function PrintLayout({ children }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [loading, user, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <PageLoader />
      </div>
    )
  }
  if (!user) return null

  return children
}

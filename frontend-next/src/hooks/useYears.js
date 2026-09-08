import { useState, useEffect } from 'react'
import { getDistinctYears } from '../api/feesApi'

const NOW = new Date()
const FALLBACK = [NOW.getFullYear() + 1, NOW.getFullYear(), NOW.getFullYear() - 1, NOW.getFullYear() - 2]

let cached = null

export default function useYears() {
  const [years, setYears] = useState(cached || FALLBACK)

  useEffect(() => {
    if (cached) return
    getDistinctYears()
      .then(({ data }) => {
        const yrs = data.years?.length ? data.years : FALLBACK
        cached = yrs
        setYears(yrs)
      })
      .catch(() => {})
  }, [])

  return years
}

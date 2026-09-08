// Class-name options with a module-level stale-while-revalidate cache, in the
// same spirit as useYears: the first visit fetches; every later mount renders
// the cached list instantly and refreshes it in the background. Used by the
// Students filters, the Fee records filters, and the student form selects —
// these dropdowns now populate with zero perceived delay after the first load.
import { useState, useEffect } from 'react'
import { getClassRooms } from '../api/feesApi'

let cached = null

export default function useClassOptions() {
  const [options, setOptions] = useState(cached || [])

  useEffect(() => {
    let alive = true
    getClassRooms()
      .then(({ data }) => {
        const names = (data.results ?? data).map(c => c.name)
        cached = names
        if (alive) setOptions(names)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  return options
}

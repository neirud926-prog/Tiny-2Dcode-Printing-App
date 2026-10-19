import { useEffect, useState } from 'react'
import { localIsoDate } from '../../core/expiry'

/** Today's local date as `yyyy-mm-dd`, kept current if the app is left open past midnight. */
export function useToday(): string {
  const [today, setToday] = useState(() => localIsoDate(new Date()))
  useEffect(() => {
    const timer = setInterval(() => setToday(localIsoDate(new Date())), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
}

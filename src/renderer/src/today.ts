import { useEffect, useState } from 'react'

/** The local calendar date of `date` as `yyyy-mm-dd` (not UTC: a label printed at 7 am is dated today). */
export function localIsoDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Today's local date as `yyyy-mm-dd`, kept current if the app is left open past midnight. */
export function useToday(): string {
  const [today, setToday] = useState(() => localIsoDate(new Date()))
  useEffect(() => {
    const timer = setInterval(() => setToday(localIsoDate(new Date())), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
}

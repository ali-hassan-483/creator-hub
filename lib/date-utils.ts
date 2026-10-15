/**
 * Date and timezone utilities for Creator Hub.
 * Pakistan Time (PKT, UTC+5) is used for daily automation limits and resets.
 */

/**
 * Returns a Date object representing 12:00:00 AM (midnight) today in Pakistan Time (PKT, UTC+5).
 * Resets daily at exactly 12:00 AM Pakistan Time.
 */
export function getPakistanTodayStart(): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const pktDateStr = formatter.format(new Date()) // Returns "YYYY-MM-DD" in Asia/Karachi
  return new Date(`${pktDateStr}T00:00:00+05:00`)
}

/**
 * Checks whether a given timestamp falls on today in Pakistan Time (since 12:00 AM PKT).
 */
export function isTodayPakistan(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  const start = getPakistanTodayStart()
  return d.getTime() >= start.getTime()
}

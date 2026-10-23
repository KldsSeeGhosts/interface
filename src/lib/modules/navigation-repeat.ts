// Bound fast native keyboard repeats without discarding 100 ms gamepad repeats.
// The margin below 100 ms tolerates small differences in event dispatch timing.
const REPEAT_INTERVAL = 80

export function createNavigationRepeatGate () {
  let lastKey: string | undefined
  let lastNavigationAt = -Infinity

  return (key: string, repeat: boolean, now = performance.now()) => {
    if (repeat && key === lastKey && now - lastNavigationAt < REPEAT_INTERVAL) return false
    lastKey = key
    lastNavigationAt = now
    return true
  }
}

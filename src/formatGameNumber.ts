const gameNumberFormatter = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const gameIntegerFormatter = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  maximumFractionDigits: 0,
})

export function formatGameNumber(value: number): string {
  const displayValue = Math.abs(value) < 0.01 ? 0 : value
  return gameNumberFormatter.format(displayValue)
}

export function formatGameInteger(value: number): string {
  return gameIntegerFormatter.format(value)
}

export function formatVigor(value: number): string {
  return String(Math.min(100, Math.max(0, Math.ceil(value))))
}

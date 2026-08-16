import { describe, expect, it } from 'vitest'
import { formatGameInteger, formatGameNumber, formatVigor } from './formatGameNumber'

describe('formatGameNumber', () => {
  it.each([
    { value: 0, expected: '0.00' },
    { value: 0.009, expected: '0.00' },
    { value: -0.009, expected: '0.00' },
    { value: 0.25, expected: '0.25' },
    { value: 0.5, expected: '0.50' },
    { value: 1, expected: '1.00' },
    { value: 1.236, expected: '1.24' },
    { value: -12.345, expected: '-12.35' },
    { value: -0, expected: '0.00' },
  ])('formats $value as $expected', ({ value, expected }) => {
    expect(formatGameNumber(value)).toBe(expected)
  })

  it.each([
    { value: 0, expected: '0' },
    { value: 1, expected: '1' },
    { value: 4, expected: '4' },
    { value: 10, expected: '10' },
    { value: 199.6, expected: '200' },
  ])('formats integer $value as $expected', ({ value, expected }) => {
    expect(formatGameInteger(value)).toBe(expected)
  })

  it.each([
    { value: -1, expected: '0' },
    { value: 0, expected: '0' },
    { value: 0.01, expected: '1' },
    { value: 33.333, expected: '34' },
    { value: 99.01, expected: '100' },
    { value: 100, expected: '100' },
    { value: 101, expected: '100' },
  ])('formats vigor $value as $expected', ({ value, expected }) => {
    expect(formatVigor(value)).toBe(expected)
  })
})

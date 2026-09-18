/** Six-digit dates use YYMMDD in the range 2000–2099. Validation stays with the schema. */
export function normalizeTaskDateInput(input: string): string {
  const value = input.trim()
  if (/^\d{6}$/.test(value)) return `20${value.slice(0, 2)}-${value.slice(2, 4)}-${value.slice(4, 6)}`
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  const match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  return match ? `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}` : value
}

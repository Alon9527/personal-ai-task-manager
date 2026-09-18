export function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.items)
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
}

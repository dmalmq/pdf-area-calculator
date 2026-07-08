const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5']

export function colorForName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]
}

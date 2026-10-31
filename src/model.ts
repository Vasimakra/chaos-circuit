export const COLORS = ['#61e8ff', '#ff668e', '#b98bff', '#a8f56c', '#ffc45c', '#ff8fe2', '#66a9ff', '#f78755']
export const ROUNDS = [
  { name: 'RED FLOOR', title: 'The floor is lava', color: '#ff526f', icon: '◈', hint: 'Keep moving. Red tiles drain your score.' },
  { name: 'SAFE ZONE', title: 'Find the green', color: '#8dfc83', icon: '◎', hint: 'Get inside the glowing circle for bonus points.' },
  { name: 'REVERSE CONTROLS', title: 'Left is right', color: '#bb85ff', icon: '↔', hint: 'Your movement is reversed. Trust your instincts.' },
  { name: 'MOVING WALLS', title: 'Don’t get boxed in', color: '#fc78dc', icon: '▰', hint: 'Crossing barriers costs points. Find a gap.' },
  { name: 'SPEED SURGE', title: 'Go full throttle', color: '#56dfff', icon: '»', hint: 'Everyone moves faster. Cyan lanes give another boost.' },
  { name: 'FINAL SHIFT', title: 'The arena is shrinking', color: '#ff6a77', icon: '⌗', hint: 'Stay within the closing ring to survive.' },
]
export type Player = { name: string; color: string; x: number; y: number; score: number; scoreTick?: number; active: boolean; seat: number; ready: boolean }
export type Game = { status: 'playing' | 'finished'; gameStartTime: number; seed: number }
export type Room = { hostId: string; hostName?: string; visibility?: 'public' | 'private'; discoverable?: boolean; status: 'lobby' | 'playing' | 'finished'; createdAt: number; game?: Game; players?: Record<string, Player>; seats?: Record<string, string> }
export const code = () => Math.random().toString(36).slice(2, 7).toUpperCase()
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
export const elapsedFor = (game: Game | undefined, now: number) => game ? Math.max(0, (now - game.gameStartTime) / 1000) : 0
export const roundFor = (elapsed: number) => Math.min(5, Math.floor(Math.min(179.99, elapsed) / 30))
export const secondsLeft = (elapsed: number) => Math.max(0, Math.ceil(180 - elapsed))
export function arenaConfig(seed: number, round: number, segment: number) {
  const rand = (n: number) => { const x = Math.sin(seed * 0.001 + round * 97.31 + segment * 13.71 + n * 41.7) * 43758.5453; return x - Math.floor(x) }
  return { tileX: Math.floor(rand(1) * 7), tileY: Math.floor(rand(2) * 5), safeX: 18 + rand(3) * 64, safeY: 18 + rand(4) * 64, wallX: 24 + rand(5) * 52 }
}

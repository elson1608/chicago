export type GamePhase =
  | 'lobby'
  | 'playing'
  | 'finished'

export type Player = {
  id: string
  name: string
  connected: boolean
}

export type GameState = {
  gameId: string
  phase: GamePhase

  players: Player[]

  hostPlayerId: string | null

  turnOrder: string[]
  activePlayerId: string | null
  turnNumber: number

  winnerId: string | null
}
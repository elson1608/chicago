export type GamePhase =
  | 'lobby'
  | 'playing'
  | 'finished'

export type Player = {
  id: string
  name: string
  connected: boolean
  lives: number
  inGame: boolean
  nextPlayerId: string | null
  previousPlayerId: string | null
}

export type GameState = {
  gameId: string
  roomCreated: boolean

  phase: GamePhase
  players: Record<string, Player>

  hostPlayerId: string | null
  activePlayerId: string | null

  round: RoundState | null

  extraLifePlayerId: string | null
  loserId: string | null
}

export type RoundState = {
  startingPlayerId: string
  lowestScore: number | null
  lowestPlayerId: string | null
  maxRolls: number
  turn: TurnState
  scores: Record<string, number>
}

export type DieState = {
  value: number | null
  held: boolean
}

export type RollState = {
  dice: [DieState, DieState, DieState]
  convertedDieIndices: number[]
}

export type TurnState = {
  rolls: number
  roll: RollState
}
import type { GameState } from './game-state'

export type ClientMessage =
  | { type: 'CREATE_ROOM' }
  | {
    type: 'JOIN_ROOM'
    playerId: string
    name: string
  }
  | { type: 'LEAVE_ROOM' }
  | { type: 'START_GAME' }
  | { type: 'END_TURN' }
  | { type: 'ROLL_DICE' }
  | {
    type: 'TOGGLE_DIE_HELD',
    dieIndex: number
  }

export type ServerMessage =
  | {
    type: 'GAME_STATE'
    state: GameState
  }
  | {
    type: 'ERROR'
    code: string
    message: string
  }
  | {
    type: 'CHICAGO'
  }
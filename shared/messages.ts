import type { GameState } from './game-state'

export type ClientMessage =
  | {
      type: 'JOIN_GAME'
      playerId: string
      name: string
    }
  | {
      type: 'START_GAME'
    }
  | {
      type: 'END_TURN'
    }
  | {
      type: 'ROLL_DICE'
    }
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
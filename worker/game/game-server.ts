import { Server } from 'partyserver'
import type { Connection, WSMessage } from 'partyserver'

import type { GameState } from '../../shared/game-state'
import type { ServerMessage } from '../../shared/messages'
import { clientMessageSchema } from '../../shared/schemas'

import {
  createInitialGameState,
  createRoom,
  disconnectPlayer,
  endGame,
  endTurn,
  joinRoom,
  leaveRoom,
  rollDice,
  startGame,
  toggleDieHeld,
} from './engine'

const GAME_STATE_STORAGE_KEY = 'gameState'

export class GameServer extends Server<Env> {
  private gameState!: GameState

  async onStart() {
    this.gameState =
      (await this.ctx.storage.get<GameState>(
        GAME_STATE_STORAGE_KEY,
      )) ?? createInitialGameState(this.name)
  }

  onConnect(connection: Connection) {
    console.log(
      `Connection ${connection.id} connected to room ${this.name}`,
    )

    this.sendState(connection)
  }

  async onMessage(
    connection: Connection,
    message: WSMessage,
  ) {
    if (typeof message !== 'string') {
      this.sendError(
        connection,
        'INVALID_MESSAGE',
        'Only text messages are supported.',
      )

      return
    }

    let rawMessage: unknown

    try {
      rawMessage = JSON.parse(message)
    } catch {
      this.sendError(
        connection,
        'INVALID_JSON',
        'The message is not valid JSON.',
      )

      return
    }

    const result = clientMessageSchema.safeParse(rawMessage)

    if (!result.success) {
      this.sendError(
        connection,
        'INVALID_MESSAGE',
        'The message has an invalid format.',
      )

      return
    }

    try {
      let rolledChicago = false
      switch (result.data.type) {
        case 'CREATE_ROOM':
          this.handleCreateRoom()
          break

        case 'JOIN_ROOM':
          this.handleJoinRoom(
            connection,
            result.data.playerId,
            result.data.name,
          )
          // only needed when the active player reconnects
          if (this.gameState.phase === 'playing') {
            await this.checkActivePlayerConnection()
          }
          break

        case 'LEAVE_ROOM':
          this.handleLeaveRoom(connection)
          break

        case 'START_GAME':
          this.handleStartGame(connection)
          await this.checkActivePlayerConnection()
          break

        case 'END_TURN':
          this.handleEndTurn(connection)
          await this.checkActivePlayerConnection()
          break

        case 'ROLL_DICE':
          rolledChicago =
            this.handleRollDice(connection)

          if (rolledChicago) {
            await this.checkActivePlayerConnection()
          }
          break

        case 'TOGGLE_DIE_HELD':
          this.handleToggleDieHeld(
            connection,
            result.data.dieIndex
          )
          break
      }

      await this.commitState()

      if (rolledChicago) {
        const message: ServerMessage = {
          type: 'CHICAGO',
        }

        this.broadcast(
          JSON.stringify(message),
        )
      }
    } catch (error) {
      this.handleGameError(connection, error)
    }
  }

  async onClose(connection: Connection) {
    const playerId = this.getPlayerId(connection)

    if (playerId) {
      const hasAnotherConnection =
        [...this.getConnections()].some(
          (otherConnection) =>
            otherConnection.id !== connection.id &&
            this.getPlayerId(otherConnection) === playerId,
        )

      if (!hasAnotherConnection) {
        disconnectPlayer(
          this.gameState,
          playerId,
        )
      }
    }

    const hasAnyConnection =
      [...this.getConnections()].some(
        (otherConnection) =>
          otherConnection.id !== connection.id,
      )

    if (!hasAnyConnection) {
      await this.ctx.storage.deleteAll()

      this.gameState =
        createInitialGameState(this.name)

      return
    }

    await this.checkActivePlayerConnection()
    await this.commitState()
  }

  private handleCreateRoom() {
    createRoom(this.gameState)
  }

  private handleJoinRoom(
    connection: Connection,
    playerId: string,
    name: string,
  ) {
    joinRoom(
      this.gameState,
      playerId,
      name,
    )

    connection.setState({
      playerId,
    })
  }

  private handleLeaveRoom(
    connection: Connection,
  ) {
    const playerId =
      this.requirePlayerId(connection)

    leaveRoom(
      this.gameState,
      playerId,
    )
  }

  private handleStartGame(connection: Connection) {
    const playerId = this.requirePlayerId(connection)

    startGame(
      this.gameState,
      playerId,
    )
  }

  private handleEndTurn(connection: Connection) {
    const playerId = this.requirePlayerId(connection)

    endTurn(
      this.gameState,
      playerId,
    )
  }

  private handleRollDice(
    connection: Connection,
  ): boolean {
    const playerId = this.requirePlayerId(connection)

    return rollDice(
      this.gameState,
      playerId,
    )
  }

  private handleToggleDieHeld(connection: Connection, dieIndex: number) {
    const playerId = this.requirePlayerId(connection)

    toggleDieHeld(
      this.gameState,
      playerId,
      dieIndex
    )
  }

  private requirePlayerId(
    connection: Connection,
  ): string {
    const playerId = this.getPlayerId(connection)

    if (!playerId) {
      throw new Error('NOT_JOINED')
    }

    return playerId
  }

  private getPlayerId(
    connection: Connection,
  ): string | null {
    const state = connection.state

    if (
      typeof state !== 'object' ||
      state === null ||
      !('playerId' in state)
    ) {
      return null
    }

    return typeof state.playerId === 'string'
      ? state.playerId
      : null
  }

  private async checkActivePlayerConnection(): Promise<void> {
    if (this.gameState.phase !== 'playing') {
      return
    }

    const activePlayerId = this.gameState.activePlayerId

    if (!activePlayerId) {
      throw new Error('NO_ACTIVE_PLAYER')
    }

    const activePlayer =
      this.gameState.players[activePlayerId]

    if (!activePlayer) {
      throw new Error('PLAYER_NOT_FOUND')
    }

    const alarm = await this.ctx.storage.getAlarm()

    if (!activePlayer.connected) {
      if (alarm === null) {
        await this.ctx.storage.setAlarm(
          Date.now() + 30_000,
        )
      }
    } else {
      if (alarm !== null) {
        await this.ctx.storage.deleteAlarm()
      }
    }
  }

  async onAlarm() {
    if (this.gameState.phase !== 'playing') {
      return
    }

    const activePlayerId = this.gameState.activePlayerId

    if (!activePlayerId) {
      throw new Error('NO_ACTIVE_PLAYER')
    }

    const activePlayer =
      this.gameState.players[activePlayerId]

    if (!activePlayer) {
      throw new Error('PLAYER_NOT_FOUND')
    }

    if (activePlayer.connected) {
      return
    }
    activePlayer.lives = 0
    endGame(this.gameState, activePlayerId)
    await this.commitState()
  }

  private sendState(connection: Connection) {
    const message: ServerMessage = {
      type: 'GAME_STATE',
      state: this.gameState,
    }

    connection.send(JSON.stringify(message))
  }

  private broadcastState() {
    const message: ServerMessage = {
      type: 'GAME_STATE',
      state: this.gameState,
    }

    this.broadcast(JSON.stringify(message))
  }

  private sendError(
    connection: Connection,
    code: string,
    message: string,
  ) {
    const response: ServerMessage = {
      type: 'ERROR',
      code,
      message,
    }

    connection.send(JSON.stringify(response))
  }

  private handleGameError(
    connection: Connection,
    error: unknown,
  ) {
    if (!(error instanceof Error)) {
      this.sendError(
        connection,
        'UNKNOWN_ERROR',
        'An unknown error occurred.',
      )

      return
    }

    switch (error.message) {
      case 'ROOM_ALREADY_EXISTS':
        this.sendError(
          connection,
          error.message,
          'The room already exists.',
        )
        break

      case 'CANNOT_LEAVE_ROOM_DURING_GAME':
        this.sendError(
          connection,
          error.message,
          'You cannot leave the room while a game is in progress.',
        )
        break

      case 'ROOM_NOT_FOUND':
        this.sendError(
          connection,
          error.message,
          'The room does not exist.',
        )
        break
      case 'GAME_ALREADY_STARTED':
        this.sendError(
          connection,
          error.message,
          'The game has already started.',
        )
        break

      case 'NOT_HOST':
        this.sendError(
          connection,
          error.message,
          'Only the host can start the game.',
        )
        break

      case 'NOT_ENOUGH_PLAYERS':
        this.sendError(
          connection,
          error.message,
          'At least two players are required.',
        )
        break

      case 'NOT_YOUR_TURN':
        this.sendError(
          connection,
          error.message,
          'It is not your turn.',
        )
        break

      case 'NOT_JOINED':
        this.sendError(
          connection,
          error.message,
          'You need to join the room first.',
        )
        break

      case 'NO_ACTIVE_ROUND':
        this.sendError(
          connection,
          error.message,
          'There is no active round.',
        )
        break

      case 'INVALID_DIE_INDEX':
        this.sendError(
          connection,
          error.message,
          'The selected die does not exist.',
        )
        break

      case 'DIE_NOT_ROLLED':
        this.sendError(
          connection,
          error.message,
          'You cannot hold a die before it has been rolled.',
        )
        break

      case 'MAX_ROLLS_REACHED':
        this.sendError(
          connection,
          error.message,
          'You have already used the maximum number of rolls.',
        )
        break

      case 'NO_ROLL_PERFORMED':
        this.sendError(
          connection,
          error.message,
          'You must roll at least once before ending your turn.',
        )
        break

      default:
        console.error(error)

        this.sendError(
          connection,
          'INTERNAL_ERROR',
          'An internal game error occurred.',
        )
    }
  }

  private async commitState() {
    await this.ctx.storage.put(
      GAME_STATE_STORAGE_KEY,
      this.gameState,
    )

    this.broadcastState()
  }
}
import { Server } from 'partyserver'
import type { Connection, WSMessage } from 'partyserver'

import type { GameState } from '../../shared/game-state'
import type { ServerMessage } from '../../shared/messages'
import { clientMessageSchema } from '../../shared/schemas'

const GAME_STATE_STORAGE_KEY = 'gameState'

export class GameServer extends Server<Env> {
  private gameState!: GameState

  async onStart() {
    this.gameState =
      (await this.ctx.storage.get<GameState>(GAME_STATE_STORAGE_KEY)) ?? {
        gameId: this.name,
        phase: 'lobby',
        players: [],
        hostPlayerId: null,
        turnOrder: [],
        activePlayerId: null,
        turnNumber: 0,
        winnerId: null,
      }
  }

  onConnect(connection: Connection) {
    console.log(
      `Connection ${connection.id} connected to game ${this.name}`,
    )

    this.sendState(connection)
  }

  async onMessage(connection: Connection, message: WSMessage) {
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

    switch (result.data.type) {
      case 'JOIN_GAME':
        await this.joinGame(
          connection,
          result.data.playerId,
          result.data.name,
        )
        break

      case 'START_GAME':
        await this.startGame(connection)
        break

      case 'END_TURN':
        await this.endTurn(connection)
        break
    }
  }

  async onClose(connection: Connection) {
    const playerId = this.getPlayerId(connection)

    if (!playerId) {
      return
    }

    const hasAnotherConnection = [...this.getConnections()].some(
      (otherConnection) =>
        otherConnection.id !== connection.id &&
        this.getPlayerId(otherConnection) === playerId,
    )

    if (hasAnotherConnection) {
      return
    }

    const player = this.gameState.players.find(
      (player) => player.id === playerId,
    )

    if (!player) {
      return
    }

    player.connected = false

    await this.commitState()
  }

  private async joinGame(
    connection: Connection,
    playerId: string,
    name: string,
  ) {
    const existingPlayer = this.gameState.players.find(
      (player) => player.id === playerId,
    )

    if (!existingPlayer && this.gameState.phase !== 'lobby') {
      this.sendError(
        connection,
        'GAME_ALREADY_STARTED',
        'This game has already started.',
      )

      return
    }

    if (existingPlayer) {
      existingPlayer.name = name
      existingPlayer.connected = true
    } else {
      this.gameState.players.push({
        id: playerId,
        name,
        connected: true,
      })

      if (this.gameState.hostPlayerId === null) {
        this.gameState.hostPlayerId = playerId
      }
    }

    connection.setState({
      playerId,
    })

    await this.commitState()
  }

  private async startGame(connection: Connection) {
    const playerId = this.getPlayerId(connection)

    if (!playerId) {
      this.sendError(
        connection,
        'NOT_JOINED',
        'You need to join the game first.',
      )

      return
    }

    if (playerId !== this.gameState.hostPlayerId) {
      this.sendError(
        connection,
        'NOT_HOST',
        'Only the host can start the game.',
      )

      return
    }

    if (this.gameState.phase !== 'lobby') {
      this.sendError(
        connection,
        'GAME_ALREADY_STARTED',
        'The game has already started.',
      )

      return
    }

    const connectedPlayers = this.gameState.players.filter(
      (player) => player.connected,
    )

    if (connectedPlayers.length < 2) {
      this.sendError(
        connection,
        'NOT_ENOUGH_PLAYERS',
        'At least two players are required.',
      )

      return
    }

    this.gameState.phase = 'playing'
    this.gameState.turnOrder = connectedPlayers.map(
      (player) => player.id,
    )
    this.gameState.activePlayerId =
      this.gameState.turnOrder[0] ?? null
    this.gameState.turnNumber = 1

    await this.commitState()
  }

  private async endTurn(connection: Connection) {
    const playerId = this.getPlayerId(connection)

    if (!playerId) {
      this.sendError(
        connection,
        'NOT_JOINED',
        'You need to join the game first.',
      )

      return
    }

    if (this.gameState.phase !== 'playing') {
      this.sendError(
        connection,
        'GAME_NOT_RUNNING',
        'The game is not running.',
      )

      return
    }

    if (this.gameState.activePlayerId !== playerId) {
      this.sendError(
        connection,
        'NOT_YOUR_TURN',
        'It is not your turn.',
      )

      return
    }

    const currentIndex = this.gameState.turnOrder.indexOf(playerId)

    const nextIndex =
      (currentIndex + 1) % this.gameState.turnOrder.length

    this.gameState.activePlayerId =
      this.gameState.turnOrder[nextIndex] ?? null

    this.gameState.turnNumber += 1

    await this.commitState()
  }

  private getPlayerId(connection: Connection): string | null {
    const state = connection.state

    if (typeof state !== 'object' || state === null) {
      return null
    }

    if (!('playerId' in state)) {
      return null
    }

    return typeof state.playerId === 'string'
      ? state.playerId
      : null
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

  private async commitState() {
    await this.ctx.storage.put(
      GAME_STATE_STORAGE_KEY,
      this.gameState,
    )

    this.broadcastState()
  }
}
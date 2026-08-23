import { useState } from 'react'
import { usePartySocket } from 'partysocket/react'

import type { GameState } from '../shared/game-state'
import type {
  ClientMessage,
  ServerMessage,
} from '../shared/messages'

const PLAYER_ID_KEY = 'chicago.playerId'

function getPlayerId() {
  const existingPlayerId = sessionStorage.getItem(PLAYER_ID_KEY)

  if (existingPlayerId) {
    return existingPlayerId
  }

  const playerId = crypto.randomUUID()

  sessionStorage.setItem(PLAYER_ID_KEY, playerId)

  return playerId
}

function App() {
  const [playerId] = useState(getPlayerId)
  const [name, setName] = useState('')
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const socket = usePartySocket({
    party: 'game',
    room: 'test',

    onMessage(event) {
      const message = JSON.parse(event.data) as ServerMessage

      switch (message.type) {
        case 'GAME_STATE':
          setGameState(message.state)
          setError(null)
          break

        case 'ERROR':
          setError(message.message)
          break
      }
    },
  })

  function send(message: ClientMessage) {
    socket.send(JSON.stringify(message))
  }

  function joinGame() {
    if (!name.trim()) {
      return
    }

    send({
      type: 'JOIN_GAME',
      playerId,
      name: name.trim(),
    })
  }

  function startGame() {
    send({
      type: 'START_GAME',
    })
  }

  function endTurn() {
    send({
      type: 'END_TURN',
    })
  }

  const currentPlayer = gameState?.players[playerId]

  const isHost = gameState?.hostPlayerId === playerId
  const isMyTurn = gameState?.activePlayerId === playerId

  return (
    <main>
      <h1>Chicago</h1>

      {!currentPlayer && (
        <section>
          <h2>Join game</h2>

          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            maxLength={30}
          />

          <button onClick={joinGame}>
            Join
          </button>
        </section>
      )}

      {gameState && (
        <section>
          <h2>Game: {gameState.gameId}</h2>

          <p>Phase: {gameState.phase}</p>

          {gameState.phase === 'playing' && (
            <>
              <p>
                {isMyTurn
                  ? 'It is your turn.'
                  : 'Waiting for another player.'}
              </p>
            </>
          )}

          <h3>Players</h3>

          <ul>
            {Object.values(gameState.players).map((player) => (
              <li key={player.id}>
                {player.name}
                {player.id === gameState.hostPlayerId
                  ? ' (Host)'
                  : ''}
                {!player.connected
                  ? ' (Disconnected)'
                  : ''}
              </li>
            ))}
          </ul>

          {currentPlayer &&
            isHost &&
            gameState.phase === 'lobby' && (
              <button onClick={startGame}>
                Start game
              </button>
            )}

          {currentPlayer &&
            isMyTurn &&
            gameState.phase === 'playing' && (
              <button onClick={endTurn}>
                End turn
              </button>
            )}
        </section>
      )}

      {error && (
        <p>
          Error: {error}
        </p>
      )}
    </main>
  )
}

export default App
import {
  useEffect,
  useRef,
  useState,
} from 'react'
import { usePartySocket } from 'partysocket/react'

import type { GameState } from '../shared/game-state'
import type {
  ClientMessage,
  ServerMessage,
} from '../shared/messages'

import './App.css'

const PLAYER_ID_KEY = 'chicago.playerId'

const DIE_PATTERNS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
}

type DieProps = {
  value: number | null
  held: boolean
  disabled: boolean
  rolling: boolean
  converting: boolean
  onClick: () => void
}

function getPlayerId() {
  const existingPlayerId = sessionStorage.getItem(PLAYER_ID_KEY)

  if (existingPlayerId) {
    return existingPlayerId
  }

  const playerId = crypto.randomUUID()

  sessionStorage.setItem(PLAYER_ID_KEY, playerId)

  return playerId
}

function Die({
  value,
  held,
  disabled,
  rolling,
  converting,
  onClick,
}: DieProps) {
  const [displayValue, setDisplayValue] = useState(value)
  const [isConverting, setIsConverting] = useState(false)

  useEffect(() => {
    if (!converting) {
      setDisplayValue(value)
      setIsConverting(false)
      return
    }

    // The backend already converted this die to 1.
    // Show the original 6 briefly first.
    setDisplayValue(6)

    const animationDelay = window.setTimeout(() => {
      setIsConverting(true)
    }, 300)

    const valueChange = window.setTimeout(() => {
      setDisplayValue(value)
    }, 600)

    return () => {
      window.clearTimeout(animationDelay)
      window.clearTimeout(valueChange)
    }
  }, [converting, value])

  const activeDots = new Set(
    displayValue === null
      ? []
      : DIE_PATTERNS[displayValue],
  )

  return (
    <button
      className={[
        'die',
        held ? 'held' : '',
        rolling && !held ? 'rolling' : '',
        isConverting ? 'converting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-label={
        displayValue === null
          ? 'Die not rolled'
          : `Die showing ${displayValue}${held ? ', held' : ''}`
      }
    >
      {Array.from({ length: 9 }, (_, index) => {
        const cell = index + 1

        return (
          <span
            key={cell}
            className={`dot ${activeDots.has(cell) ? 'on' : ''
              }`}
          />
        )
      })}
    </button>
  )
}

function calculateDisplayedScore(
  values: Array<number | null>,
): number | null {
  if (values.some((value) => value === null)) {
    return null
  }

  let score = 0
  let scoring = false

  for (const value of values) {
    if (value === 1) {
      score += 100
      scoring = true
    } else if (value === 6) {
      score += 60
      scoring = true
    } else {
      score += value!
    }
  }

  return scoring ? score : 0
}

type GameRoomProps = {
  roomCode: string
  isCreatingRoom: boolean
  onLeaveRoom: () => void
}

const ROOM_CODE_CHARACTERS =
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function createRoomCode() {
  return Array.from(
    { length: 6 },
    () =>
      ROOM_CODE_CHARACTERS[
        Math.floor(
          Math.random() *
          ROOM_CODE_CHARACTERS.length,
        )
      ],
  ).join('')
}

function GameRoom({
  roomCode,
  isCreatingRoom,
  onLeaveRoom,
}: GameRoomProps) {
  const [playerId] = useState(getPlayerId)
  const [name, setName] = useState('')
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rolling, setRolling] = useState(false)
  const [convertingDieIndices, setConvertingDieIndices] = useState<number[]>([])
  const [fireworkBurst, setFireworkBurst] = useState(0)
  const [disconnected, setDisconnected] = useState(false)
  const [disconnectDeadline, setDisconnectDeadline] = useState<number | null>(null)
  const [disconnectSecondsLeft, setDisconnectSecondsLeft] = useState<number | null>(null)
  const hasCreatedRoom = useRef(false)
  const [isLeavingRoom, setIsLeavingRoom] = useState(false)

  const hasIdentifiedConnection = useRef(false)
  const socket = usePartySocket({
    party: 'game',
    room: roomCode,

    onOpen(event) {
      hasIdentifiedConnection.current = false

      setDisconnected(false)
      setDisconnectDeadline(null)

      const target = event.currentTarget

      if (!target) {
        return
      }

      const openedSocket = target as WebSocket

      if (
        isCreatingRoom &&
        !hasCreatedRoom.current
      ) {
        openedSocket.send(
          JSON.stringify({
            type: 'CREATE_ROOM',
          } satisfies ClientMessage),
        )

        hasCreatedRoom.current = true
      }
    },

    onClose() {
      setDisconnected(true)
    },

    onMessage(event) {
      const message = JSON.parse(event.data) as ServerMessage

      switch (message.type) {
        case 'GAME_STATE':
          setGameState(message.state)
          setError(null)
          break

        case 'CHICAGO':
          setFireworkBurst(
            (current) => current + 1,
          )
          break

        case 'ERROR':
          setError(message.message)
          break
      }
    },
  })

  useEffect(() => {
    if (
      disconnected &&
      gameState?.activePlayerId === playerId
    ) {
      setDisconnectDeadline(Date.now() + 30_000)
    } else {
      setDisconnectDeadline(null)
    }
  }, [
    disconnected,
    gameState?.activePlayerId,
    playerId,
  ])

  useEffect(() => {
    if (disconnectDeadline === null) {
      setDisconnectSecondsLeft(null)
      return
    }

    const deadline = disconnectDeadline

    function updateCountdown() {
      const remaining = Math.max(
        0,
        Math.ceil(
          (deadline - Date.now()) / 1000,
        ),
      )

      setDisconnectSecondsLeft(remaining)
    }

    updateCountdown()

    const interval = window.setInterval(
      updateCountdown,
      250,
    )

    return () => {
      window.clearInterval(interval)
    }
  }, [disconnectDeadline])

  useEffect(() => {
    if (!gameState) {
      return
    }

    if (hasIdentifiedConnection.current) {
      return
    }

    const existingPlayer =
      gameState.players[playerId]

    if (!existingPlayer) {
      return
    }

    hasIdentifiedConnection.current = true

    send({
      type: 'JOIN_ROOM',
      playerId,
      name: existingPlayer.name,
    })
  }, [gameState, playerId])

  useEffect(() => {
    if (!isLeavingRoom || !gameState) {
      return
    }

    if (gameState.players[playerId]) {
      return
    }

    onLeaveRoom()
  }, [
    isLeavingRoom,
    gameState,
    playerId,
    onLeaveRoom,
  ])

  function send(message: ClientMessage) {
    socket.send(JSON.stringify(message))
  }

  function joinRoom() {
    if (!name.trim()) {
      return
    }

    hasIdentifiedConnection.current = true

    send({
      type: 'JOIN_ROOM',
      playerId,
      name: name.trim(),
    })
  }

  function leaveCurrentRoom() {
    setIsLeavingRoom(true)

    send({
      type: 'LEAVE_ROOM',
    })
  }

  function startGame() {
    send({
      type: 'START_GAME',
    })
  }

  function rollDice() {
    setRolling(true)

    send({
      type: 'ROLL_DICE',
    })

    window.setTimeout(() => {
      setRolling(false)
    }, 400)
  }

  function toggleDieHeld(dieIndex: number) {
    send({
      type: 'TOGGLE_DIE_HELD',
      dieIndex,
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

  const round = gameState?.round
  const turn = round?.turn


  useEffect(() => {
    if (!turn || turn.rolls === 0) {
      return
    }

    // Clear conversion state from the previous roll
    setConvertingDieIndices([])

    // Nothing was converted on this roll
    if (turn.roll.convertedDieIndices.length === 0) {
      return
    }

    // Start conversion animation for the dice converted on this roll
    setConvertingDieIndices(
      turn.roll.convertedDieIndices,
    )

    const timeout = window.setTimeout(() => {
      setConvertingDieIndices([])
    }, 900)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [turn?.rolls])

  const activePlayer =
    gameState?.activePlayerId
      ? gameState.players[gameState.activePlayerId]
      : undefined

  const loser =
    gameState?.loserId
      ? gameState.players[gameState.loserId]
      : undefined

  const currentScore =
    turn && turn.rolls > 0
      ? calculateDisplayedScore(
        turn.roll.dice.map((die) => die.value),
      )
      : null

  const displayedPlayers =
    gameState
      ? Object.values(gameState.players)
        .filter(
          (player) =>
            gameState.phase !== 'playing' ||
            player.inGame
        )
      : []

  const roomNotFound =
    gameState !== null &&
    !gameState.roomCreated &&
    !isCreatingRoom

  const showJoinForm =
    !roomNotFound &&
    !currentPlayer &&
    (!gameState || gameState.phase !== 'playing')

  return (
    <main className="app">
      {fireworkBurst > 0 && (
        <div
          key={fireworkBurst}
          className="fireworks"
          aria-hidden="true"
        >
          {Array.from({ length: 12 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      )}
      <header className="app-header">
        <h1>Chicago</h1>
        <p>Three dice. One loser.</p>
        <p>
          Room: <strong>{roomCode}</strong>
        </p>
      </header>
      {disconnected && (
        <div className="connection-warning">
          <strong>Connection lost.</strong>

          {disconnectSecondsLeft !== null ? (
            <span>
              Reconnecting... You may lose the game in{' '}
              {disconnectSecondsLeft} seconds.
            </span>
          ) : (
            <span>Reconnecting...</span>
          )}
        </div>
      )}
      {roomNotFound && (
        <section className="panel join-panel">
          <h2>Room not found</h2>

          <p>
            No room with code{' '}
            <strong>{roomCode}</strong> exists.
          </p>

          <button onClick={onLeaveRoom}>
            Back
          </button>
        </section>
      )}
      {showJoinForm && (
        <section className="panel join-panel">
          <h2>Join room</h2>

          <div className="join-controls">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  joinRoom()
                }
              }}
              placeholder="Your name"
              maxLength={30}
            />

            <button onClick={joinRoom}>
              Join
            </button>
          </div>
        </section>
      )}

      {!roomNotFound && gameState && (
        <>
          <section className="panel">
            <div className="section-heading">
              <h2>Players</h2>

              <div className="room-actions">
                {currentPlayer &&
                  isHost &&
                  gameState.phase === 'lobby' && (
                    <button onClick={startGame}>
                      Start game
                    </button>
                  )}

                {currentPlayer &&
                  gameState.phase !== 'playing' && (
                    <button
                      onClick={leaveCurrentRoom}
                      disabled={isLeavingRoom}
                    >
                      {isLeavingRoom
                        ? 'Leaving...'
                        : 'Leave room'}
                    </button>
                  )}
              </div>
            </div>

            <ul className="player-list">
              {displayedPlayers.map((player) => (
                <li
                  key={player.id}
                  className={[
                    player.id === gameState.activePlayerId
                      ? 'active-player'
                      : '',
                    !player.connected
                      ? 'disconnected-player'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div>
                    <strong>{player.name}</strong>

                    {player.id === playerId && (
                      <span className="player-tag">You</span>
                    )}

                    {player.id === gameState.hostPlayerId && (
                      <span className="player-tag">Host</span>
                    )}

                    {!player.connected && (
                      <span className="player-tag warning">
                        Disconnected
                      </span>
                    )}
                  </div>

                  <span className="lives">
                    {player.id === gameState.extraLifePlayerId && player.lives === 1 ? (
                      <span className="heart half-heart">♥</span>
                    ) : (
                      Array.from(
                        { length: player.lives },
                        (_, index) => (
                          <span
                            className="heart"
                            key={index}
                          >
                            ♥
                          </span>
                        ),
                      )
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {gameState.phase === 'playing' && round && turn && (
            <section className="panel game-board">
              <div className="turn-heading">
                <div>
                  <h2>
                    {isMyTurn
                      ? 'Your turn'
                      : `${activePlayer?.name ?? 'Player'}'s turn`}
                  </h2>

                  <p>
                    Rolls: {turn.rolls} / {round.maxRolls}
                  </p>
                </div>

                <div className="score-box">
                  <span className="label">Score</span>
                  <strong>
                    {currentScore === null ? '—' : currentScore}
                  </strong>
                </div>
              </div>

              <div className="dice-row">
                {turn.roll.dice.map((die, dieIndex) => (
                  <div
                    className="die-wrapper"
                    key={dieIndex}
                  >
                    <Die
                      value={die.value}
                      held={die.held}
                      rolling={rolling}
                      converting={
                        convertingDieIndices.includes(dieIndex)
                      }
                      disabled={
                        !isMyTurn ||
                        turn.rolls === 0
                      }
                      onClick={() =>
                        toggleDieHeld(dieIndex)
                      }
                    />
                    <span
                      className={`hold-label ${die.held ? 'active' : ''
                        }`}
                    >
                      {turn.rolls === 0
                        ? ''
                        : die.held
                          ? 'Held'
                          : isMyTurn
                            ? 'Click to hold'
                            : ''}
                    </span>
                  </div>
                ))}
              </div>

              <div className="game-controls">
                <button
                  className="primary-action"
                  onClick={rollDice}
                  disabled={
                    !isMyTurn ||
                    turn.rolls >= round.maxRolls ||
                    rolling
                  }
                >
                  Roll Dice
                </button>

                <button
                  onClick={endTurn}
                  disabled={
                    !isMyTurn ||
                    turn.rolls === 0 ||
                    rolling
                  }
                >
                  End Turn
                </button>
              </div>

              <div className="round-info">
                <span>
                  Lowest score:{' '}
                  <strong>
                    {round.lowestScore ?? '—'}
                  </strong>
                </span>

                <span>
                  Lowest player:{' '}
                  <strong>
                    {round.lowestPlayerId
                      ? gameState.players[
                        round.lowestPlayerId
                      ]?.name ?? '—'
                      : '—'}
                  </strong>
                </span>
              </div>
            </section>
          )}

          {gameState.phase === 'finished' && (
            <section className="panel result-panel">
              <h2>Game over</h2>

              <p>
                {loser
                  ? `${loser.name} lost the game.`
                  : 'The game has finished.'}
              </p>

              {currentPlayer && isHost && (
                <button
                  className="primary-action"
                  onClick={startGame}
                >
                  Play again
                </button>
              )}
            </section>
          )}
        </>
      )}

      {error && !roomNotFound && (
        <p className="error-message">
          Error: {error}
        </p>
      )}
    </main>
  )
}


function App() {
  const [roomCode, setRoomCode] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)

    return params.get('room')?.toUpperCase() ?? null
  })

  const [isCreatingRoom, setIsCreatingRoom] =
    useState(false)

  const [joinCode, setJoinCode] =
    useState('')

  function createRoom() {
    const code = createRoomCode()

    setIsCreatingRoom(true)
    setRoomCode(code)

    window.history.pushState(
      null,
      '',
      `?room=${code}`,
    )
  }

  function leaveRoom() {
    setRoomCode(null)
    setIsCreatingRoom(false)
    setJoinCode('')

    window.history.pushState(
      null,
      '',
      window.location.pathname,
    )
  }

  function joinRoomByCode() {
    const code = joinCode
      .trim()
      .toUpperCase()

    if (code.length !== 6) {
      return
    }

    setIsCreatingRoom(false)
    setRoomCode(code)

    window.history.pushState(
      null,
      '',
      `?room=${code}`,
    )
  }

  if (roomCode) {
    return (
      <GameRoom
        roomCode={roomCode}
        isCreatingRoom={isCreatingRoom}
        onLeaveRoom={leaveRoom}
      />
    )
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>Chicago</h1>
        <p>Three dice. One loser.</p>
      </header>

      <section className="panel join-panel">
        <button
          className="primary-action"
          onClick={createRoom}
        >
          Create Room
        </button>

        <div className="join-controls">
          <input
            value={joinCode}
            onChange={(event) =>
              setJoinCode(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                joinRoomByCode()
              }
            }}
            placeholder="Enter Room Code"
            maxLength={6}
          />

          <button onClick={joinRoomByCode}>
            Join Room
          </button>
        </div>
      </section>
    </main>
  )
}

export default App

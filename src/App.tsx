import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import {usePartySocket} from 'partysocket/react'
import {supabase} from './supabase'
import type {Session} from '@supabase/supabase-js'
import {
    getCurrentSession,
    completeAuthCallback,
    resendConfirmationEmail,
    signInWithPassword,
    signOut,
    signUpWithPassword,
} from './auth'
import {
    createProfile,
    getProfileName,
} from './profile'
import type {GameState} from '../shared/game-state'
import type {
    ClientMessage,
    ServerMessage,
} from '../shared/messages'

import {PlayerStats} from './components/PlayerStats'
import './App.css'

type AuthMode = 'signIn' | 'signUp'
type FieldErrors = {email?: string; password?: string}

function friendlyAuthError(error: unknown, mode?: AuthMode) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''

    if (message.includes('invalid login credentials')) {
        return 'Email or password is incorrect.'
    }
    if (message.includes('email not confirmed')) {
        return 'Confirm your email before signing in.'
    }
    if (message.includes('already registered') || message.includes('already been registered')) {
        return 'An account already exists for this email. Try signing in instead.'
    }
    if (message.includes('rate limit') || message.includes('too many requests')) {
        return 'Too many attempts. Please wait a moment and try again.'
    }
    if (message.includes('password')) {
        return mode === 'signUp'
            ? 'This password does not meet this project\'s password requirements.'
            : 'Check your password and try again.'
    }
    if (message.includes('network') || message.includes('fetch')) {
        return 'Could not reach Chicago. Check your connection and try again.'
    }

    return 'Something went wrong. Please try again.'
}

function validateAuth(email: string, password: string): FieldErrors {
    const errors: FieldErrors = {}
    if (!email) {
        errors.email = 'Enter your email address.'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = 'Enter a valid email address.'
    }
    if (!password) {
        errors.password = 'Password is required.'
    }
    return errors
}

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


function Die({
                 value,
                 held,
                 disabled,
                 rolling,
                 converting,
                 onClick,
             }: DieProps) {
    const [conversionComplete, setConversionComplete] =
        useState(false)

    const [isConverting, setIsConverting] =
        useState(false)

    useEffect(() => {
        if (!converting) {
            return
        }

        const animationDelay =
            window.setTimeout(() => {
                setIsConverting(true)
            }, 300)

        const conversionCompleteTimeout =
            window.setTimeout(() => {
                setConversionComplete(true)
            }, 600)

        return () => {
            window.clearTimeout(animationDelay)
            window.clearTimeout(
                conversionCompleteTimeout,
            )
        }
    }, [converting])

    const displayValue =
        converting && !conversionComplete
            ? 6
            : value

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
            {Array.from({length: 9}, (_, index) => {
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
    playerId: string
    playerName: string
    accessToken: string
    isCreatingRoom: boolean
    onLeaveRoom: () => void
}

const ROOM_CODE_CHARACTERS =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const FINAL_ROLL_AUTO_END_DELAY_MS = 5

const ZERO_SCORE_LOSS_NAMES: Record<number, string> = {
    1: 'Loch',
    2: 'Futterluke',
    3: 'Muschlettn',
}

function createRoomCode() {
    return Array.from(
        {length: 6},
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
                      playerId,
                      playerName,
                      accessToken,
                      isCreatingRoom,
                      onLeaveRoom,
                  }: GameRoomProps) {
    const [gameState, setGameState] = useState<GameState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [fireworkBurst, setFireworkBurst] = useState(0)
    const [disconnected, setDisconnected] = useState(false)
    const hasCreatedRoom = useRef(false)
    const [isLeavingRoom, setIsLeavingRoom] = useState(false)
    const [chicagoAnimation, setChicagoAnimation] = useState<'idle' | 'rolling' | 'celebrating'>('idle')
    const [optimisticHeld, setOptimisticHeld] =
        useState<Record<number, boolean>>({})
    const [optimisticRollNumber, setOptimisticRollNumber] =
        useState<number | null>(null)
    const [turnChangeId, setTurnChangeId] = useState(0)
    const [roundLossNotice, setRoundLossNotice] = useState<{
        loserId: string
        score: number
        rolls: number
    } | null>(null)
    const roundLossNoticeTimeout = useRef<number | null>(null)
    const [turnResultNotice, setTurnResultNotice] = useState<{
        playerId: string
        score: number
        nextPlayerId: string
    } | null>(null)
    const turnResultNoticeTimeout = useRef<number | null>(null)
    const hasIdentifiedConnection = useRef(false)
    const previousTurn = useRef<{
        activePlayerId: string | null
    } | null>(null)
    const socket = usePartySocket({
        party: 'game',
        room: roomCode,

        query: {
            access_token: accessToken,
        },

        onOpen(event) {
            hasIdentifiedConnection.current = false

            setDisconnected(false)

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
                case 'GAME_STATE': {
                    const nextActivePlayerId =
                        message.state.activePlayerId

                    const previous =
                        previousTurn.current

                    // A new cue is created only when the active seat changes.
                    // Roll, score, and connection updates leave this untouched.
                    if (
                        previous !== null &&
                        previous.activePlayerId !== nextActivePlayerId
                    ) {
                        setTurnChangeId((current) => current + 1)
                    }

                    previousTurn.current = {
                        activePlayerId: nextActivePlayerId,
                    }

                    setOptimisticHeld((current) => {
                        const serverTurn =
                            message.state.round?.turn

                        if (!serverTurn) {
                            return {}
                        }

                        const next = {...current}

                        for (
                            const [indexString, expectedHeld]
                            of Object.entries(current)
                            ) {
                            const dieIndex = Number(indexString)

                            if (
                                serverTurn.roll.dice[dieIndex]?.held ===
                                expectedHeld
                            ) {
                                delete next[dieIndex]
                            }
                        }

                        return next
                    })

                    setOptimisticRollNumber((current) => {
                        if (current === null) {
                            return null
                        }

                        if (
                            message.state.activePlayerId !== playerId
                        ) {
                            return null
                        }

                        const serverRolls =
                            message.state.round?.turn.rolls

                        if (
                            serverRolls === undefined ||
                            serverRolls >= current
                        ) {
                            return null
                        }

                        return current
                    })

                    setGameState(message.state)
                    setError(null)
                    break
                }

                case 'CHICAGO':
                    setChicagoAnimation('rolling')

                    window.setTimeout(() => {
                        setChicagoAnimation('celebrating')

                        setFireworkBurst(
                            (current) => current + 1,
                        )
                    }, 400)

                    window.setTimeout(() => {
                        setChicagoAnimation('idle')
                    }, 1200)

                    break

                case 'ROUND_RESULT':
                    setRoundLossNotice({
                        loserId: message.loserId,
                        score: message.score,
                        rolls: message.rolls,
                    })

                    if (roundLossNoticeTimeout.current !== null) {
                        window.clearTimeout(roundLossNoticeTimeout.current)
                    }

                    roundLossNoticeTimeout.current = window.setTimeout(() => {
                        setRoundLossNotice(null)
                        roundLossNoticeTimeout.current = null
                    }, 3_200)
                    break

                case 'TURN_RESULT':
                    setTurnResultNotice({
                        playerId: message.playerId,
                        score: message.score,
                        nextPlayerId: message.nextPlayerId,
                    })

                    if (turnResultNoticeTimeout.current !== null) {
                        window.clearTimeout(turnResultNoticeTimeout.current)
                    }

                    turnResultNoticeTimeout.current = window.setTimeout(() => {
                        setTurnResultNotice(null)
                        turnResultNoticeTimeout.current = null
                    }, 1_800)
                    break

                case 'ERROR':
                    setOptimisticRollNumber(null)
                    setError(message.message)
                    break
            }
        },
    })

    const send = useCallback(
        (message: ClientMessage) => {
            socket.send(JSON.stringify(message))
        },
        [socket],
    )

    useEffect(() => {
        if (!gameState) {
            return
        }

        if (!gameState.roomCreated) {
            return
        }

        if (hasIdentifiedConnection.current) {
            return
        }

        const existingPlayer =
            gameState.players[playerId]

        if (
            !existingPlayer &&
            gameState.phase === 'playing'
        ) {
            return
        }

        hasIdentifiedConnection.current = true

        send({
            type: 'JOIN_ROOM',
            name: playerName,
        })
    }, [
        gameState,
        playerId,
        playerName,
        send,
    ])

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
        if (
            !turn ||
            !isMyTurn ||
            optimisticRollNumber !== null
        ) {
            return
        }

        setOptimisticRollNumber(
            turn.rolls + 1,
        )

        send({
            type: 'ROLL_DICE',
        })
    }

    function toggleDieHeld(dieIndex: number) {
        if (!turn) {
            return
        }

        const serverHeld =
            turn.roll.dice[dieIndex].held

        const displayedHeld =
            optimisticHeld[dieIndex] ?? serverHeld

        setOptimisticHeld((current) => ({
            ...current,
            [dieIndex]: !displayedHeld,
        }))

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
    const displayedRollNumber =
        turn
            ? optimisticRollNumber ?? turn.rolls
            : 0

    const activePlayer =
        gameState?.activePlayerId
            ? gameState.players[gameState.activePlayerId]
            : undefined

    const nextPlayerId =
        gameState?.phase === 'playing'
            ? activePlayer?.nextPlayerId ?? null
            : null

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

    const rollsRemaining =
        turn && round
            ? round.maxRolls - displayedRollNumber
            : 0

    const needsFirstRoll =
        isMyTurn &&
        displayedRollNumber === 0 &&
        optimisticRollNumber === null

    const hasReachedFinalRoll = Boolean(
        isMyTurn &&
        turn &&
        round &&
        optimisticRollNumber === null &&
        turn.rolls === round.maxRolls,
    )

    useEffect(() => {
        if (!hasReachedFinalRoll) {
            return
        }

        const timeout = window.setTimeout(() => {
            send({type: 'END_TURN'})
        }, FINAL_ROLL_AUTO_END_DELAY_MS)

        return () => {
            window.clearTimeout(timeout)
        }
    }, [hasReachedFinalRoll, send])

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

    const roundLoserName = roundLossNotice
        ? gameState?.players[roundLossNotice.loserId]?.name ?? 'Player'
        : null
    const zeroScoreLossName =
        roundLossNotice?.score === 0
            ? ZERO_SCORE_LOSS_NAMES[roundLossNotice.rolls] ?? null
            : null
    const roundLossSubject = roundLossNotice?.loserId === playerId
        ? 'You'
        : roundLoserName
    const turnResultPlayerName = turnResultNotice
        ? gameState?.players[turnResultNotice.playerId]?.name ?? 'Player'
        : null
    const nextDicingPlayerName = turnResultNotice
        ? gameState?.players[turnResultNotice.nextPlayerId]?.name ?? 'Player'
        : null

    return (
            <main className="app">
            {turnResultNotice && !roundLossNotice && (
                <div
                    className="turn-result-notice"
                    role="status"
                    aria-live="polite"
                >
                    <div>
                        <span className="label">Turn complete</span>
                        <strong>
                            {turnResultNotice.playerId === playerId
                                ? `You scored ${turnResultNotice.score}`
                                : `${turnResultPlayerName} scored ${turnResultNotice.score}`}
                        </strong>
                        <p>{nextDicingPlayerName} is now dicing</p>
                    </div>
                </div>
            )}
            {roundLossNotice && (
                <div
                    className="round-result-notice"
                    role="status"
                    aria-live="assertive"
                >
                    <div>
                        <span className="label">Round result</span>
                        <strong>
                            {zeroScoreLossName
                                ? `${roundLossSubject} lost with 0 (${zeroScoreLossName})`
                                : `${roundLossSubject} lost the round`}
                        </strong>
                        {!zeroScoreLossName && (
                            <p>
                                Lost with <b>{roundLossNotice.score}</b>
                            </p>
                        )}
                    </div>
                </div>
            )}
            {fireworkBurst > 0 && (
                <div
                    key={fireworkBurst}
                    className="fireworks"
                    aria-hidden="true"
                >
                    {Array.from({length: 12}, (_, index) => (
                        <span key={index}/>
                    ))}
                </div>
            )}
            <header className="app-header">
                <div className="app-header-row">
                    <a
                        className="app-logo-link"
                        href="/"
                    >
                        <h1>Chicago</h1>
                        <p>Three dice. One loser.</p>
                    </a>

                    <div className="room-code">
                        <span>Room</span>
                        <strong>{roomCode}</strong>
                    </div>
                </div>
            </header>
            {disconnected && (
                <div className="connection-warning">
                    <strong>Connection lost.</strong>
                    <span>Reconnecting...</span>
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
                            {displayedPlayers.map((player) => {
                                const playerRoundScore =
                                    player.id === gameState.activePlayerId
                                        ? currentScore
                                        : round?.scores[player.id] ?? null

                                return (
                                    <li
                                    key={`${player.id}-${
                                        player.id === gameState.activePlayerId
                                            ? turnChangeId
                                            : 'inactive'
                                    }`}
                                    aria-current={
                                        player.id === gameState.activePlayerId
                                            ? 'true'
                                            : undefined
                                    }
                                    className={[
                                        player.id === gameState.activePlayerId
                                            ? 'active-player'
                                            : '',
                                        player.id === gameState.activePlayerId &&
                                        turnChangeId > 0
                                            ? 'turn-arrival'
                                            : '',
                                        player.id === nextPlayerId
                                            ? 'next-player'
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

                                        {round && (
                                            <span className="player-score">
                                                Score <b>{playerRoundScore ?? '—'}</b>
                                            </span>
                                        )}

                                        {player.id === playerId && (
                                            <span className="player-tag">You</span>
                                        )}
                                        {player.id === nextPlayerId && (
                                            <span className="player-tag next">Next</span>
                                        )}
                                        {player.id === gameState.activePlayerId && (
                                            <span className="player-tag acting">Acting</span>
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
                            {length: player.lives},
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
                                )
                            })}
                        </ul>
                    </section>

                    {chicagoAnimation !== 'idle' && (
                        <section className="panel game-board">
                            <div className="dice-row">
                                {[1, 1, 1].map((value, dieIndex) => (
                                    <div
                                        className="die-wrapper"
                                        key={`chicago-${dieIndex}`}
                                    >
                                        <Die
                                            value={value}
                                            held={false}
                                            rolling={chicagoAnimation === 'rolling'}
                                            converting={false}
                                            disabled={true}
                                            onClick={() => {
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {chicagoAnimation === 'idle' &&
                        gameState.phase === 'playing' &&
                        round &&
                        turn && (
                            <section
                                key={`board-${gameState.activePlayerId}-${turnChangeId}`}
                                className={`panel game-board ${
                                    isMyTurn ? 'my-turn' : 'watching-turn'
                                } ${turnChangeId > 0 ? 'turn-arrival' : ''}`}
                            >
                                <div className="turn-heading">
                                    <div>
                                        <h2>
                                            {isMyTurn
                                                ? 'Your turn'
                                                : `${activePlayer?.name ?? 'Player'}'s turn`}
                                        </h2>
                                        <p>
                                            {isMyTurn
                                                ? 'Your move — roll the dice to begin.'
                                                : 'Watch the table for the next move.'}
                                        </p>
                                    </div>
                                </div>

                                <div
                                    className={`dice-stage ${
                                        needsFirstRoll ? 'awaiting-roll' : ''
                                    }`}
                                >
                                    <div className="dice-row">
                                        {turn.roll.dice.map((die, dieIndex) => (
                                            <div
                                                className={`die-wrapper ${
                                                    isMyTurn &&
                                                    needsFirstRoll &&
                                                    turnChangeId > 0
                                                        ? 'turn-entry-die'
                                                        : ''
                                                }`}
                                                key={`${displayedRollNumber}-${dieIndex}`}
                                            >
                                                <Die
                                                    value={die.value}
                                                    held={
                                                        optimisticHeld[dieIndex] ??
                                                        die.held
                                                    }
                                                    rolling={displayedRollNumber > 0}
                                                    converting={
                                                        optimisticRollNumber === null &&
                                                        turn.roll.convertedDieIndices.includes(
                                                            dieIndex,
                                                        )
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
                                                    className={`hold-label ${(optimisticHeld[dieIndex] ?? die.held)
                                                        ? 'active'
                                                        : ''
                                                    }`}
                                                >
                            {turn.rolls === 0
                                ? ''
                                : (optimisticHeld[dieIndex] ?? die.held)
                                    ? 'Held'
                                    : isMyTurn
                                        ? 'Click to hold'
                                        : ''}
                          </span>
                                            </div>
                                        ))}
                                    </div>

                                    {needsFirstRoll && (
                                        <>
                                            <p
                                                className={`score-to-beat ${
                                                    round.lowestScore === null
                                                        ? 'no-score-to-beat'
                                                        : ''
                                                }`}
                                            >
                                                {round.lowestScore === null
                                                    ? 'Set the score to beat'
                                                    : `Nedded: ${round.lowestScore} in ${rollsRemaining}`}
                                            </p>
                                            <button
                                                className={`primary-action roll-prompt ${
                                                    turnChangeId > 0
                                                        ? 'turn-cta'
                                                        : ''
                                                }`}
                                                onClick={rollDice}
                                            >
                                                Roll Dice
                                            </button>
                                        </>
                                    )}
                                </div>

                                <p className="rolls-remaining" aria-live="polite">
                                    {rollsRemaining} {rollsRemaining === 1 ? 'roll' : 'rolls'} remaining
                                </p>

                                <div className="score-box">
                                    <span className="label">Current score</span>
                                    <strong>
                                        {currentScore === null ? '—' : currentScore}
                                    </strong>
                                </div>

                                {isMyTurn && !needsFirstRoll && (
                                    <div className="game-controls">
                                        <button
                                            className="primary-action roll-dice-button"
                                            onClick={rollDice}
                                            disabled={
                                                turn.rolls >= round.maxRolls ||
                                                optimisticRollNumber !== null
                                            }
                                        >
                                            Roll Dice
                                        </button>

                                        <button
                                            onClick={endTurn}
                                            disabled={
                                                turn.rolls === 0 ||
                                                optimisticRollNumber !== null
                                            }
                                        >
                                            End Turn
                                        </button>
                                    </div>
                                )}

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

                    {chicagoAnimation === 'idle' &&
                        gameState.phase === 'finished' && (
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
    const [playerName, setPlayerName] =
        useState<string | null>(null)
    const [authSession, setAuthSession] =
        useState<Session | null>(null)
    const [authLoaded, setAuthLoaded] =
        useState(false)
    const [authMode, setAuthMode] =
        useState<AuthMode>('signIn')
    const [emailInput, setEmailInput] =
        useState('')
    const [passwordInput, setPasswordInput] =
        useState('')
    const emailInputRef = useRef<HTMLInputElement>(null)
    const passwordInputRef = useRef<HTMLInputElement>(null)
    const [authSubmitting, setAuthSubmitting] =
        useState(false)
    const [authError, setAuthError] =
        useState<string | null>(null)
    const [fieldErrors, setFieldErrors] =
        useState<FieldErrors>({})
    const [showPassword, setShowPassword] = useState(false)
    const [confirmationEmail, setConfirmationEmail] =
        useState<string | null>(() => sessionStorage.getItem('chicago.confirmationEmail'))
    const [isResendingConfirmation, setIsResendingConfirmation] =
        useState(false)
    const [resendMessage, setResendMessage] =
        useState<string | null>(null)
    const [resendCooldown, setResendCooldown] = useState(0)
    const [isAuthCallback] = useState(
        () => new URLSearchParams(window.location.search).get('auth') === 'callback',
    )
    const [callbackState, setCallbackState] = useState<
        'idle' | 'confirming' | 'success' | 'error'
    >(() => isAuthCallback
        ? 'confirming'
        : 'idle')
    const [profileLoaded, setProfileLoaded] =
        useState(false)
    const [profileError, setProfileError] =
        useState<string | null>(null)
    const [isSavingProfile, setIsSavingProfile] =
        useState(false)
    const [nameInput, setNameInput] =
        useState('')
    const [roomCode, setRoomCode] = useState<string | null>(() => {
        const params = new URLSearchParams(window.location.search)

        return params.get('room')?.toUpperCase() ?? null
    })

    const [isCreatingRoom, setIsCreatingRoom] =
        useState(false)

    const [joinCode, setJoinCode] =
        useState('')

    async function submitAuth() {
        const email =
            emailInput.trim()

        if (authSubmitting) {
            return
        }

        const errors = validateAuth(email, passwordInput)
        setFieldErrors(errors)
        if (Object.keys(errors).length > 0) {
            window.setTimeout(() => {
                if (errors.email) {
                    emailInputRef.current?.focus()
                } else {
                    passwordInputRef.current?.focus()
                }
            }, 0)
            return
        }

        setAuthSubmitting(true)
        setAuthError(null)

        try {
            if (authMode === 'signIn') {
                const session =
                    await signInWithPassword(
                        email,
                        passwordInput,
                    )

                setAuthSession(session)
            } else {
                const session =
                    await signUpWithPassword(
                        email,
                        passwordInput,
                    )

                if (session) {
                    setAuthSession(session)
                } else {
                    sessionStorage.setItem('chicago.confirmationEmail', email)
                    setConfirmationEmail(email)
                }
            }
        } catch (error: unknown) {
            setAuthError(friendlyAuthError(error, authMode))
        } finally {
            setAuthSubmitting(false)
        }
    }

    async function resendConfirmation() {
        if (!confirmationEmail || isResendingConfirmation || resendCooldown > 0) {
            return
        }

        setIsResendingConfirmation(true)
        setResendMessage(null)
        try {
            await resendConfirmationEmail(confirmationEmail)
            setResendMessage('Confirmation email sent. Check your inbox.')
            setResendCooldown(60)
        } catch (error: unknown) {
            setResendMessage(friendlyAuthError(error))
        } finally {
            setIsResendingConfirmation(false)
        }
    }

    async function logout() {
        try {
            await signOut()

            setAuthSession(null)
            setPlayerName(null)
            setProfileLoaded(false)
        } catch (error: unknown) {
            if (error instanceof Error) {
                setAuthError(error.message)
            } else {
                setAuthError('Sign out failed.')
            }
        }
    }

    async function continueWithName() {
        const trimmedName =
            nameInput.trim()

        if (
            !trimmedName ||
            !authenticatedUserId ||
            isSavingProfile
        ) {
            return
        }

        setIsSavingProfile(true)
        setProfileError(null)

        try {
            const savedName =
                await createProfile(
                    authenticatedUserId,
                    trimmedName,
                )

            setPlayerName(savedName)
        } catch (error: unknown) {
            if (error instanceof Error) {
                setProfileError(error.message)
            } else {
                setProfileError(
                    'Failed to create profile.',
                )
            }
        } finally {
            setIsSavingProfile(false)
        }
    }

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

    useEffect(() => {
        if (resendCooldown === 0) {
            return
        }

        const timer = window.setTimeout(() => {
            setResendCooldown((seconds) => Math.max(0, seconds - 1))
        }, 1000)

        return () => window.clearTimeout(timer)
    }, [resendCooldown])

    useEffect(() => {
        let cancelled = false

        const {
            data: {subscription},
        } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                if (!cancelled) {
                    setAuthSession(session)
                    setAuthLoaded(true)
                }
            },
        )

        const restoreSession = async () => {
            try {
                const session = isAuthCallback
                    ? await completeAuthCallback()
                    : await getCurrentSession()

                if (cancelled) {
                    return
                }

                setAuthSession(session)
                setAuthLoaded(true)

                if (isAuthCallback) {
                    if (!session) {
                        throw new Error('No session was created.')
                    }
                    window.history.replaceState(null, '', window.location.pathname)
                    sessionStorage.removeItem('chicago.confirmationEmail')
                    setCallbackState('success')
                    window.setTimeout(() => {
                        if (!cancelled) setCallbackState('idle')
                    }, 700)
                }
            } catch (error: unknown) {
                if (cancelled) return
                if (isAuthCallback) {
                    setAuthError(friendlyAuthError(error))
                    setCallbackState('error')
                } else {
                    setAuthError(friendlyAuthError(error))
                }
                setAuthLoaded(true)
            }
        }

        restoreSession()

        return () => {
            cancelled = true
            subscription.unsubscribe()
        }
    }, [isAuthCallback])

    const authenticatedUserId =
        authSession?.user.id

    useEffect(() => {
        if (!authenticatedUserId) {
            return
        }

        let cancelled = false

        getProfileName(authenticatedUserId)
            .then((displayName) => {
                if (cancelled) {
                    return
                }

                setPlayerName(displayName)
                setProfileLoaded(true)
            })
            .catch((error: unknown) => {
                if (cancelled) {
                    return
                }

                if (error instanceof Error) {
                    setProfileError(error.message)
                } else {
                    setProfileError(
                        'Failed to load profile.',
                    )
                }

                setProfileLoaded(true)
            })

        return () => {
            cancelled = true
        }
    }, [authenticatedUserId])

    if (callbackState === 'confirming' || callbackState === 'success' || callbackState === 'error') {
        return (
            <main className="app auth-page">
                <header className="app-header">
                    <a className="app-logo-link" href="/">
                        <h1>Chicago</h1>
                        <p>Three dice. One loser.</p>
                    </a>
                </header>
                <section className="panel auth-card auth-status" aria-live="polite">
                    <span className="auth-status-mark" aria-hidden="true">
                        {callbackState === 'error' ? '!' : '✓'}
                    </span>
                    <h2>{callbackState === 'error' ? 'Confirmation failed' : callbackState === 'success' ? 'Email confirmed' : 'Confirming account…'}</h2>
                    <p>{callbackState === 'error'
                        ? 'This link may have expired or already been used.'
                        : callbackState === 'success'
                            ? 'Welcome to Chicago.'
                            : 'Just a moment.'}</p>
                    {callbackState === 'error' && (
                        <>
                            <p className="form-error">{authError}</p>
                            <button className="primary-action" onClick={() => {
                                setCallbackState('idle')
                                window.history.replaceState(null, '', window.location.pathname)
                            }}>Return to sign in</button>
                            {confirmationEmail && <button className="text-button" onClick={resendConfirmation} disabled={isResendingConfirmation || resendCooldown > 0}>
                                {isResendingConfirmation ? 'Sending…' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend confirmation'}
                            </button>}
                        </>
                    )}
                </section>
            </main>
        )
    }

    if (!authLoaded) {
        return (
            <main className="app auth-page">
                <p>Loading...</p>
            </main>
        )
    }

    if (!authSession) {
        return (
            <main className="app">
                <header className="app-header">
                    <a
                        className="app-logo-link"
                        href="/"
                    >
                        <h1>Chicago</h1>
                        <p>Three dice. One loser.</p>
                    </a>
                </header>

                <section className="panel auth-card">
                    {confirmationEmail ? (
                        <div className="auth-status" aria-live="polite">
                            <span className="auth-status-mark" aria-hidden="true">✓</span>
                            <h2>Check your inbox</h2>
                            <p>We sent a confirmation link to:</p>
                            <strong className="confirmation-email">{confirmationEmail}</strong>
                            <p>Confirm your email address to finish creating your Chicago account.</p>
                            <button className="primary-action" onClick={resendConfirmation} disabled={isResendingConfirmation || resendCooldown > 0}>
                                {isResendingConfirmation ? 'Sending…' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend email'}
                            </button>
                            {resendMessage && <p className="auth-feedback" role="status">{resendMessage}</p>}
                            <button className="text-button" onClick={() => {
                                setConfirmationEmail(null)
                                setPasswordInput('')
                                setResendMessage(null)
                            }}>Use another email</button>
                        </div>
                    ) : (
                        <>
                            <div className="auth-tabs" role="tablist" aria-label="Authentication options">
                                {(['signIn', 'signUp'] as const).map((mode) => (
                                    <button key={mode} type="button" role="tab" aria-selected={authMode === mode} className={authMode === mode ? 'active' : ''} disabled={authSubmitting} onClick={() => {
                                        setAuthMode(mode)
                                        setAuthError(null)
                                        setFieldErrors({})
                                    }}>{mode === 'signIn' ? 'Sign in' : 'Create account'}</button>
                                ))}
                            </div>
                            <form className="auth-form" noValidate onSubmit={(event) => { event.preventDefault(); submitAuth() }}>
                                <div className="auth-field">
                                    <label htmlFor="auth-email">Email</label>
                                    <input ref={emailInputRef} id="auth-email" type="email" inputMode="email" value={emailInput} onChange={(event) => { setEmailInput(event.target.value); setFieldErrors((errors) => ({...errors, email: undefined})) }} placeholder="you@example.com" autoComplete="email" disabled={authSubmitting} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined} />
                                    {fieldErrors.email && <p id="auth-email-error" className="field-error">{fieldErrors.email}</p>}
                                </div>
                                <div className="auth-field">
                                    <label htmlFor="auth-password">Password</label>
                                    <div className="password-input-wrap">
                                        <input ref={passwordInputRef} id="auth-password" type={showPassword ? 'text' : 'password'} value={passwordInput} onChange={(event) => { setPasswordInput(event.target.value); setFieldErrors((errors) => ({...errors, password: undefined})) }} placeholder="••••••••" autoComplete={authMode === 'signIn' ? 'current-password' : 'new-password'} disabled={authSubmitting} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined} />
                                        <button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
                                    </div>
                                    {fieldErrors.password && <p id="auth-password-error" className="field-error">{fieldErrors.password}</p>}
                                </div>
                                {authError && <p className="form-error" role="alert">{authError}</p>}
                                <button className="primary-action auth-submit" disabled={authSubmitting}>
                                    {authSubmitting ? <><span className="spinner" aria-hidden="true" />{authMode === 'signIn' ? 'Signing in…' : 'Creating account…'}</> : authMode === 'signIn' ? 'Sign in' : 'Create account'}
                                </button>
                                {authMode === 'signIn' && <button type="button" className="text-button forgot-password" disabled>Forgot password?</button>}
                            </form>
                        </>
                    )}
                </section>
            </main>
        )
    }

    if (profileError) {
        return (
            <main className="app">
                <p>
                    Profile error: {profileError}
                </p>
            </main>
        )
    }

    if (!profileLoaded) {
        return (
            <main className="app">
                <p>Loading...</p>
            </main>
        )
    }
    if (!playerName) {
        return (
            <main className="app">
                <header className="app-header">
                    <a
                        className="app-logo-link"
                        href="/"
                    >
                        <h1>Chicago</h1>
                        <p>Three dice. One loser.</p>
                    </a>
                </header>

                <section className="panel join-panel">
                    <h2>What's your name?</h2>

                    <div className="join-controls">
                        <input
                            value={nameInput}
                            onChange={(event) =>
                                setNameInput(event.target.value)
                            }
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    continueWithName()
                                }
                            }}
                            placeholder="Your name"
                            maxLength={30}
                            autoFocus
                            disabled={isSavingProfile}
                        />

                        <button
                            className="primary-action"
                            onClick={continueWithName}
                            disabled={isSavingProfile}
                        >
                            {isSavingProfile
                                ? 'Saving...'
                                : 'Continue'}
                        </button>
                    </div>
                </section>
            </main>
        )
    }

    if (roomCode) {
        return (
            <GameRoom
                roomCode={roomCode}
                playerId={authSession.user.id}
                playerName={playerName}
                accessToken={authSession.access_token}
                isCreatingRoom={isCreatingRoom}
                onLeaveRoom={leaveRoom}
            />
        )
    }

    return (
        <main className="app">
            <header className="app-header">
                <div className="app-header-row">
                    <a
                        className="app-logo-link"
                        href="/"
                    >
                        <h1>Chicago</h1>
                        <p>Three dice. One loser.</p>
                    </a>

                    <div className="account-controls">
                        <span>{playerName}</span>

                        <button onClick={logout}>
                            Sign out
                        </button>
                    </div>
                </div>
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

            <PlayerStats
                userId={authSession.user.id}
            />
        </main>
    )
}

export default App

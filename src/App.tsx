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

import './App.css'

const DIE_PATTERNS: Record<number, number[]> = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
}

function vibrate(
    pattern: number | number[],
) {
    if ('vibrate' in navigator) {
        navigator.vibrate(pattern)
    }
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

    const hasIdentifiedConnection = useRef(false)
    const previousTurn = useRef<{
        activePlayerId: string | null
        rolls: number | null
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

                    const nextRolls =
                        message.state.round?.turn.rolls ?? null

                    const previous =
                        previousTurn.current

                    const becameMyTurn =
                        nextActivePlayerId === playerId &&
                        previous !== null &&
                        (
                            previous.activePlayerId !== playerId ||
                            (
                                previous.activePlayerId === playerId &&
                                previous.rolls !== null &&
                                previous.rolls > 0 &&
                                nextRolls === 0
                            )
                        )

                    if (becameMyTurn) {
                        vibrate(120)
                    }

                    previousTurn.current = {
                        activePlayerId: nextActivePlayerId,
                        rolls: nextRolls,
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
                    vibrate([
                        120,
                        60,
                        120,
                        60,
                        250,
                    ])

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

    return (
        <main className="app">
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
                    <div>
                        <h1>Chicago</h1>
                        <p>Three dice. One loser.</p>
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
                            ))}
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

                                <div className="game-controls">
                                    <button
                                        className="primary-action"
                                        onClick={rollDice}
                                        disabled={
                                            !isMyTurn ||
                                            turn.rolls >= round.maxRolls ||
                                            optimisticRollNumber !== null
                                        }
                                    >
                                        Roll Dice
                                    </button>

                                    <button
                                        onClick={endTurn}
                                        disabled={
                                            !isMyTurn ||
                                            turn.rolls === 0 ||
                                            optimisticRollNumber !== null
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
        useState<'signIn' | 'signUp'>('signIn')
    const [emailInput, setEmailInput] =
        useState('')
    const [passwordInput, setPasswordInput] =
        useState('')
    const [authSubmitting, setAuthSubmitting] =
        useState(false)
    const [authMessage, setAuthMessage] =
        useState<string | null>(null)
    const [authError, setAuthError] =
        useState<string | null>(null)
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

        if (
            !email ||
            !passwordInput ||
            authSubmitting
        ) {
            return
        }

        setAuthSubmitting(true)
        setAuthError(null)
        setAuthMessage(null)

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
                    setAuthMessage(
                        'Check your email to confirm your account.',
                    )
                }
            }
        } catch (error: unknown) {
            if (error instanceof Error) {
                setAuthError(error.message)
            } else {
                setAuthError(
                    'Authentication failed.',
                )
            }
        } finally {
            setAuthSubmitting(false)
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

        getCurrentSession()
            .then((session) => {
                if (!cancelled) {
                    setAuthSession(session)
                    setAuthLoaded(true)
                }
            })
            .catch((error: unknown) => {
                if (cancelled) {
                    return
                }

                if (error instanceof Error) {
                    setAuthError(error.message)
                } else {
                    setAuthError(
                        'Authentication failed.',
                    )
                }

                setAuthLoaded(true)
            })

        return () => {
            cancelled = true
            subscription.unsubscribe()
        }
    }, [])

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

    if (authError) {
        return (
            <main className="app">
                <p>
                    Authentication failed: {authError}
                </p>
            </main>
        )
    }

    if (!authLoaded) {
        return (
            <main className="app">
                <p>Loading...</p>
            </main>
        )
    }

    if (!authSession) {
        return (
            <main className="app">
                <header className="app-header">
                    <h1>Chicago</h1>
                    <p>Three dice. One loser.</p>
                </header>

                <section className="panel join-panel">
                    <h2>
                        {authMode === 'signIn'
                            ? 'Sign in'
                            : 'Create account'}
                    </h2>

                    <div className="join-controls">
                        <input
                            type="email"
                            value={emailInput}
                            onChange={(event) =>
                                setEmailInput(
                                    event.target.value,
                                )
                            }
                            placeholder="Email"
                            autoComplete="email"
                            disabled={authSubmitting}
                        />

                        <input
                            type="password"
                            value={passwordInput}
                            onChange={(event) =>
                                setPasswordInput(
                                    event.target.value,
                                )
                            }
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    submitAuth()
                                }
                            }}
                            placeholder="Password"
                            autoComplete={
                                authMode === 'signIn'
                                    ? 'current-password'
                                    : 'new-password'
                            }
                            disabled={authSubmitting}
                        />

                        <button
                            className="primary-action"
                            onClick={submitAuth}
                            disabled={authSubmitting}
                        >
                            {authSubmitting
                                ? 'Please wait...'
                                : authMode === 'signIn'
                                    ? 'Sign in'
                                    : 'Create account'}
                        </button>
                    </div>

                    {authMessage && (
                        <p>{authMessage}</p>
                    )}

                    <button
                        onClick={() => {
                            setAuthMode(
                                authMode === 'signIn'
                                    ? 'signUp'
                                    : 'signIn',
                            )

                            setAuthError(null)
                            setAuthMessage(null)
                        }}
                        disabled={authSubmitting}
                    >
                        {authMode === 'signIn'
                            ? 'Create an account'
                            : 'Already have an account? Sign in'}
                    </button>
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
                    <h1>Chicago</h1>
                    <p>Three dice. One loser.</p>
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
                    <div>
                        <h1>Chicago</h1>
                        <p>Three dice. One loser.</p>
                    </div>

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
        </main>
    )
}

export default App

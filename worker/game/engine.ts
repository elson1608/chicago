import type {
    GameState,
    Player,
    DieState,
    TurnState,
    RoundState,
    RollState
} from '../../shared/game-state'

const STARTING_LIVES = 2

export function createInitialGameState(
    gameId: string,
): GameState {
    return {
        gameId,
        roomCreated: false,

        phase: 'lobby',
        players: {},

        hostPlayerId: null,

        activePlayerId: null,

        round: null,

        extraLifePlayerId: null,
        loserId: null,
    }
}

export function createRoom(
    gameState: GameState,
) {
    if (gameState.roomCreated) {
        throw new Error('ROOM_ALREADY_EXISTS')
    }

    gameState.roomCreated = true
}

export function joinRoom(
    gameState: GameState,
    playerId: string,
    name: string,
) {
    if (!gameState.roomCreated) {
        throw new Error('ROOM_NOT_FOUND')
    }

    const existingPlayer = gameState.players[playerId]

    // An existing player can rejoin 
    if (existingPlayer) {
        reconnectPlayer(gameState, playerId, name)
        return
    }

    // New players can only join when the game hasn't started yet
    if (gameState.phase === 'playing') {
        throw new Error('GAME_ALREADY_STARTED')
    }

    const player: Player = {
        id: playerId,
        name,
        connected: true,
        lives: STARTING_LIVES,
        inGame: false,
        nextPlayerId: null,
        previousPlayerId: null,
    }

    // First player becomes the host
    if (Object.keys(gameState.players).length === 0) {
        gameState.hostPlayerId = player.id
    }

    // Player is added to the room
    gameState.players[player.id] = player
}


export function leaveRoom(
    gameState: GameState,
    playerId: string,
) {
    if (gameState.phase === 'playing') {
        throw new Error('CANNOT_LEAVE_ROOM_DURING_GAME')
    }

    const player = gameState.players[playerId]

    if (!player) {
        throw new Error('PLAYER_NOT_FOUND')
    }

    const wasHost = gameState.hostPlayerId === playerId

    delete gameState.players[playerId]

    // If the loser left we remove this
    if (gameState.loserId === playerId) {
        gameState.loserId = null
    }

    // If the host leaves we replace him with the next connected player in the room 
    if (wasHost) {
        const nextHost = Object.values(gameState.players)
            .find((player) => player.connected)

        gameState.hostPlayerId =
            nextHost?.id ?? null
    }
}

function removePlayerFromRing(
    gameState: GameState,
    player: Player,
) {

    // Only one player is in the ring
    if (player.previousPlayerId === null && player.nextPlayerId === null) {
        return
    }
    // If only previous or next player exist the ring structure is invalid
    if (!player.previousPlayerId || !player.nextPlayerId) {
        throw new Error('INVALID_PLAYER_RING')
    } else {
        const previousPlayer = gameState.players[player.previousPlayerId]
        const nextPlayer = gameState.players[player.nextPlayerId]

        if (!previousPlayer || !nextPlayer) {
            throw new Error('PLAYER_NOT_FOUND')
        }
        previousPlayer.nextPlayerId = nextPlayer.id
        nextPlayer.previousPlayerId = previousPlayer.id

        player.previousPlayerId = null
        player.nextPlayerId = null
    }
}

function reversePlayerRing(
    gameState: GameState,
) {
    for (
        const player
        of Object.values(gameState.players)
        ) {
        if (!player.inGame) {
            continue
        }

        if (
            !player.nextPlayerId ||
            !player.previousPlayerId
        ) {
            throw new Error('INVALID_PLAYER_RING')
        }

        const nextPlayerId =
            player.nextPlayerId

        player.nextPlayerId =
            player.previousPlayerId

        player.previousPlayerId =
            nextPlayerId
    }
}

function reconnectPlayer(
    gameState: GameState,
    playerId: string,
    name: string,
) {
    const player = gameState.players[playerId]

    if (!player) {
        throw new Error('PLAYER_NOT_FOUND')
    }

    player.connected = true
    player.name = name

    if (gameState.hostPlayerId === null) {
        gameState.hostPlayerId = player.id
    }
}

export function disconnectPlayer(
    gameState: GameState,
    playerId: string,
) {
    const player = gameState.players[playerId]

    if (!player) {
        return
    }

    player.connected = false

    if (gameState.hostPlayerId === playerId) {
        const nextHost = Object.values(gameState.players)
            .find((player) => player.connected)

        gameState.hostPlayerId = nextHost?.id ?? null
    }
}

function constructRing(
    players: Player[],
) {
    for (let i = 0; i < players.length; i++) {
        const player = players[i]

        const previousPlayer = players.at(i - 1)!
        const nextPlayer = players.at((i + 1) % players.length)!

        player.inGame = true
        player.previousPlayerId = previousPlayer.id
        player.nextPlayerId = nextPlayer.id
    }
}

export function startGame(
    gameState: GameState,
    playerId: string,
) {
    if (gameState.phase === 'playing') {
        throw new Error('GAME_ALREADY_STARTED')
    }

    if (playerId !== gameState.hostPlayerId) {
        throw new Error('NOT_HOST')
    }

    // Connected room members participate in the game
    const players = Object.values(gameState.players).filter((player) => player.connected)

    if (players.length <= 1) {
        throw new Error('NOT_ENOUGH_PLAYERS')
    }

    // Reset player state for the new game
    for (const player of players) {
        player.lives = STARTING_LIVES
    }

    // Reset game state
    gameState.extraLifePlayerId = null
    gameState.loserId = null

    // Set up Ring structure
    constructRing(players)

    const startingPlayer = players[Math.floor(Math.random() * players.length)]

    gameState.phase = 'playing'

    startRound(gameState, startingPlayer.id)
}

export function endGame(
    gameState: GameState,
    loserId: string,
) {

    const loser = gameState.players[loserId]

    if (!loser) {
        throw new Error('PLAYER_NOT_FOUND')
    }

    loser.lives = 0

    // Reset game-specific player state and ring links
    for (const player of Object.values(gameState.players)) {
        player.inGame = false
        player.previousPlayerId = null
        player.nextPlayerId = null
    }


    gameState.loserId = loserId
    gameState.activePlayerId = null
    gameState.round = null
    gameState.phase = 'finished'
}


function calculateScore(
    dice: [DieState, DieState, DieState],
): number {
    let score = 0
    let scoring = false

    for (const die of dice) {
        if (die.value === null) {
            throw new Error('DICE_NOT_ROLLED')
        }

        if (die.value === 1) {
            score += 100
            scoring = true
        } else if (die.value === 6) {
            score += 60
            scoring = true
        } else {
            score += die.value
        }
    }

    return scoring ? score : 0
}

export function toggleDieHeld(
    gameState: GameState,
    playerId: string,
    dieIndex: number,
) {
    if (gameState.activePlayerId !== playerId) {
        throw new Error('NOT_YOUR_TURN')
    }

    const round = gameState.round

    if (!round) {
        throw new Error('NO_ACTIVE_ROUND')
    }

    const die = round.turn.roll.dice[dieIndex]

    if (!die) {
        throw new Error('INVALID_DIE_INDEX')
    }

    if (round.turn.rolls === 0) {
        throw new Error('DIE_NOT_ROLLED')
    }

    die.held = !die.held
}

function updateLowestScore(
    gameState: GameState,
) {
    const round = gameState.round

    if (!round) {
        throw new Error('NO_ACTIVE_ROUND')
    }

    const playerId = gameState.activePlayerId

    if (!playerId) {
        throw new Error('NO_ACTIVE_PLAYER')
    }

    const score = calculateScore(round.turn.roll.dice)

    if (
        round.lowestScore === null ||
        score <= round.lowestScore
    ) {
        round.lowestScore = score
        round.lowestPlayerId = playerId
    }
}

function isChicago(
    roll: RollState,
): boolean {
    return roll.dice.every(
        (die) => die.value === 1,
    )
}

function advanceTurn(
    gameState: GameState,
    activePlayer: Player,
) {
    if (!activePlayer.nextPlayerId) {
        throw new Error('INVALID_PLAYER_RING')
    }

    const round = gameState.round

    if (!round) {
        throw new Error('NO_ACTIVE_ROUND')
    }

    round.turn = createTurnState(round.turn.roll.dice)

    gameState.activePlayerId = activePlayer.nextPlayerId
}

function isRoundFinished(
    round: RoundState,
    activePlayer: Player,
): boolean {
    return activePlayer.nextPlayerId === round.startingPlayerId
}

export function rollDice(
    gameState: GameState,
    playerId: string,
) {
    if (gameState.activePlayerId !== playerId) {
        throw new Error('NOT_YOUR_TURN')
    }

    const activePlayer = gameState.players[playerId]

    if (!activePlayer) {
        throw new Error('PLAYER_NOT_FOUND')
    }

    const round = gameState.round

    if (!round) {
        throw new Error('NO_ACTIVE_ROUND')
    }

    const turn = round.turn
    const roll = turn.roll

    if (turn.rolls >= round.maxRolls) {
        throw new Error('MAX_ROLLS_REACHED')
    }

    // Reset information from the previous roll
    roll.convertedDieIndices = []

    // Roll all dice that are not held
    for (const die of roll.dice) {
        if (!die.held) {
            die.value = Math.floor(Math.random() * 6) + 1
        }
    }
    turn.rolls++

    // Chicago immediately ends the player's turn
    if (isChicago(roll)) {
        handleChicago(
            gameState,
            activePlayer,
            turn,
        )

        return true
    }

    // Find all dice currently showing a six
    const sixIndices: number[] = []

    for (let i = 0; i < roll.dice.length; i++) {
        if (roll.dice[i].value === 6) {
            sixIndices.push(i)
        }
    }

    // If there is more than one six,
    // convert all except one into ones
    for (let i = 0; i < sixIndices.length - 1; i++) {
        const dieIndex = sixIndices[i]

        roll.dice[dieIndex].value = 1
        roll.convertedDieIndices.push(dieIndex)
    }

    return false
}

function createTurnState(
    previousDice?: [DieState, DieState, DieState]
): TurnState {
    // We want to display what the previous player has rolled first
    if (previousDice) {
        return {
            roll: {
                dice: [
                    {
                        value: previousDice[0].value,
                        held: false
                    },
                    {
                        value: previousDice[1].value,
                        held: false
                    },
                    {
                        value: previousDice[2].value,
                        held: false
                    },
                ],
                convertedDieIndices: []
            },
            rolls: 0,
        }
    }

    // If the game has just started the dice show a Chicago
    else {
        return {
            roll: {
                dice: [
                    {
                        value: 1,
                        held: false
                    },
                    {
                        value: 1,
                        held: false
                    },
                    {
                        value: 1,
                        held: false
                    },
                ],
                convertedDieIndices: []
            },
            rolls: 0,
        }
    }
}

function startRound(
    gameState: GameState,
    startingPlayerId: string,
    previousDice?: [DieState, DieState, DieState],
) {

    gameState.activePlayerId = startingPlayerId
    gameState.round = {
        startingPlayerId,
        lowestScore: null,
        lowestPlayerId: null,
        maxRolls: 3,
        turn: createTurnState(previousDice),
    }
}

function finishRound(
    gameState: GameState,
    round: RoundState
) {
    if (!round.lowestPlayerId) {
        throw new Error('NO_LOSING_PLAYER')
    }

    const losingPlayer = gameState.players[round.lowestPlayerId]

    if (!losingPlayer) {
        throw new Error('PLAYER_NOT_FOUND')
    }

    if (losingPlayer.lives === 1) {
        if (gameState.extraLifePlayerId !== null) {
            losingPlayer.lives = 0
            endGame(gameState, losingPlayer.id)
        }
        else {
            gameState.extraLifePlayerId = losingPlayer.id
            startRound(gameState, losingPlayer.id, round.turn.roll.dice)
        }
    }
    else {
        losingPlayer.lives--
        startRound(gameState, losingPlayer.id, round.turn.roll.dice)
    }
}

function handleChicago(
    gameState: GameState,
    activePlayer: Player,
    turn: TurnState,
) {
    if (
        !activePlayer.nextPlayerId ||
        !activePlayer.previousPlayerId
    ) {
        throw new Error('INVALID_PLAYER_RING')
    }

    const previousPlayerId =
        activePlayer.previousPlayerId

    // After a Chicago the player leaves
    // the game and the direction reverses
    activePlayer.inGame = false
    removePlayerFromRing(
        gameState,
        activePlayer,
    )

    const remainingPlayers =
        Object.values(gameState.players)
            .filter((player) => player.inGame)

    if (remainingPlayers.length === 1) {
        endGame(
            gameState,
            remainingPlayers[0].id,
        )
    } else {
        reversePlayerRing(gameState)

        startRound(
            gameState,
            previousPlayerId,
            turn.roll.dice,
        )
    }
}

export function endTurn(
    gameState: GameState,
    playerId: string,
) {
    if (gameState.activePlayerId !== playerId) {
        throw new Error('NOT_YOUR_TURN')
    }

    const activePlayer = gameState.players[playerId]

    if (!activePlayer) {
        throw new Error('PLAYER_NOT_FOUND')
    }

    const round = gameState.round

    if (!round) {
        throw new Error('NO_ACTIVE_ROUND')
    }

    if (round.turn.rolls === 0) {
        throw new Error('NO_ROLL_PERFORMED')
    }

    updateLowestScore(gameState)

    // First player of the round determines maximum number of rolls
    if (activePlayer.id === round.startingPlayerId) {
        round.maxRolls = round.turn.rolls
    }

    if (isRoundFinished(round, activePlayer)) {
        finishRound(gameState, round)
        return
    }

    advanceTurn(gameState, activePlayer)
}


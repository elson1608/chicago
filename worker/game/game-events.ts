export type GameEvent =
    | {
    type: 'GAME_STARTED'
    playerIds: string[]
}
    | {
    type: 'ROUND_COMPLETED'
    playerId: string
    score: number
}
    | {
    type: 'ROUND_LOST'
    playerId: string
}
    | {
    type: 'CHICAGO'
    playerId: string
}
    | {
    type: 'EXTRA_LIFE_CLAIMED'
    playerId: string
}
    | {
    type: 'GAME_LOST'
    playerId: string
}
import {supabase} from './supabase'
import type {PlayerStats} from '../shared/player-stats'

const EMPTY_STATS: PlayerStats = {
    games_played: 0,
    rounds_played: 0,
    rounds_lost: 0,
    average_round_score: 0,
    games_lost: 0,
    chicagos: 0,
    extra_lives_claimed: 0,
}

export async function getPlayerStats(
    userId: string,
): Promise<PlayerStats> {
    const {
        data,
        error,
    } = await supabase
        .from('player_stats')
        .select(`
            games_played,
            rounds_played,
            rounds_lost,
            average_round_score,
            games_lost,
            chicagos,
            extra_lives_claimed
        `)
        .eq('user_id', userId)
        .maybeSingle()

    if (error) {
        throw error
    }

    return data ?? EMPTY_STATS
}
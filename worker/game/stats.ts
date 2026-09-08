import type {GameEvent} from './game-events'
import {createSupabaseAdminClient} from '../supabase'

export async function recordGameEvents(
    env: Env,
    events: GameEvent[],
) {
    if (events.length === 0) {
        return
    }

    const supabase =
        createSupabaseAdminClient(env)

    for (const event of events) {
        switch (event.type) {
            case 'GAME_STARTED': {
                const {error} =
                    await supabase.rpc(
                        'record_game_started',
                        {
                            p_user_ids:
                            event.playerIds,
                        },
                    )

                if (error) {
                    throw error
                }

                break
            }

            case 'ROUND_COMPLETED': {
                const {error} =
                    await supabase.rpc(
                        'record_round_completed',
                        {
                            p_user_id:
                            event.playerId,
                            p_score:
                            event.score,
                        },
                    )

                if (error) {
                    throw error
                }

                break
            }

            case 'ROUND_LOST': {
                const {error} =
                    await supabase.rpc(
                        'record_round_lost',
                        {
                            p_user_id:
                            event.playerId,
                        },
                    )

                if (error) {
                    throw error
                }

                break
            }

            case 'CHICAGO': {
                const {error} =
                    await supabase.rpc(
                        'record_chicago',
                        {
                            p_user_id:
                            event.playerId,
                        },
                    )

                if (error) {
                    throw error
                }

                break
            }

            case 'EXTRA_LIFE_CLAIMED': {
                const {error} =
                    await supabase.rpc(
                        'record_extra_life_claimed',
                        {
                            p_user_id:
                            event.playerId,
                        },
                    )

                if (error) {
                    throw error
                }

                break
            }

            case 'GAME_LOST': {
                const {error} =
                    await supabase.rpc(
                        'record_game_lost',
                        {
                            p_user_id:
                            event.playerId,
                        },
                    )

                if (error) {
                    throw error
                }

                break
            }
        }
    }
}
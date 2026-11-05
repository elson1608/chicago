import {createSupabaseAdminClient} from './supabase'

export async function keepSupabaseAlive(
    env: Env,
) {
    const supabase =
        createSupabaseAdminClient(env)

    const {error} = await supabase
        .from('keep_alive')
        .upsert({
            id: 1,
            last_ping:
                new Date().toISOString(),
        })

    if (error) {
        throw new Error(
            error.message,
        )
    }
}
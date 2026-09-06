import { supabase } from './supabase'

export async function getProfileName(
    userId: string,
): Promise<string | null> {
    const { data, error } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('user_id', userId)
        .maybeSingle()

    if (error) {
        throw error
    }

    return data?.display_name ?? null
}

export async function createProfile(
    userId: string,
    displayName: string,
): Promise<string> {
    const trimmedName = displayName.trim()

    const { data, error } = await supabase
        .from('profiles')
        .insert({
            user_id: userId,
            display_name: trimmedName,
        })
        .select('display_name')
        .single()

    if (error) {
        throw error
    }

    return data.display_name
}
import type { Session } from '@supabase/supabase-js'

import { supabase } from './supabase'

export async function getCurrentSession():
    Promise<Session | null> {
    const {
        data: {session},
        error,
    } = await supabase.auth.getSession()

    if (error) {
        throw error
    }

    return session
}

export async function signInWithPassword(
    email: string,
    password: string,
): Promise<Session> {
    const {
        data,
        error,
    } = await supabase.auth.signInWithPassword({
        email,
        password,
    })

    if (error) {
        throw error
    }

    return data.session
}

export async function signOut() {
    const {error} =
        await supabase.auth.signOut()

    if (error) {
        throw error
    }
}

export async function signUpWithPassword(
    email: string,
    password: string,
): Promise<Session | null> {
    const {
        data,
        error,
    } = await supabase.auth.signUp({
        email,
        password,
    })

    if (error) {
        throw error
    }

    return data.session
}
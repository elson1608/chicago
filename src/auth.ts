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
        options: {
            // Keep this relative to the deployed app rather than a development URL.
            emailRedirectTo: `${window.location.origin}/?auth=callback`,
        },
    })

    if (error) {
        throw error
    }

    return data.session
}

export async function resendConfirmationEmail(email: string) {
    const {error} = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
            emailRedirectTo: `${window.location.origin}/?auth=callback`,
        },
    })

    if (error) {
        throw error
    }
}

/**
 * Supabase's current client is configured for implicit flow, but accepting a
 * code here also makes the callback safe if the project is switched to PKCE in
 * the dashboard/client configuration later.
 */
export async function completeAuthCallback(): Promise<Session | null> {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')

    if (code) {
        const {data, error} =
            await supabase.auth.exchangeCodeForSession(code)

        if (error) {
            throw error
        }

        return data.session
    }

    return getCurrentSession()
}

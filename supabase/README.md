# Supabase email setup

This project uses Supabase's browser **implicit** auth flow (the default client
configuration), with a callback at `/?auth=callback`. The client also accepts a
`?code=` callback and exchanges it using Supabase's supported API, so it is safe
to move to PKCE later without changing the callback screen.

Hosted Supabase email templates are not deployed from this repository. In the
Supabase Dashboard, go to **Authentication → Email Templates → Confirm signup**
and paste the contents of `templates/confirmation.html`. Leave
`{{ .ConfirmationURL }}` intact.

In **Authentication → URL Configuration**:

1. Set **Site URL** to the production Chicago origin (for example,
   `https://chicago.example.com`).
2. Add both the production callback URL (`https://chicago.example.com/?auth=callback`)
   and the local development callback URL (for example,
   `http://localhost:5173/?auth=callback`) to **Redirect URLs**. Use the actual
   Vite port if it differs.

The app supplies its redirect from `window.location.origin`, so no localhost URL
is embedded in application code.

import { routePartykitRequest } from 'partyserver'

export { GameServer } from './game/game-server'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ??
      new Response('Not Found', { status: 404 })
    )
  },
} satisfies ExportedHandler<Env>
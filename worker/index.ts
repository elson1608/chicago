import { routePartykitRequest } from 'partyserver'
import {keepSupabaseAlive} from './keep-alive'
export { GameServer } from './game/game-server'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ??
      new Response('Not Found', { status: 404 })
    )
  },
  async scheduled(
      controller: ScheduledController,
      env: Env,
      _ctx: ExecutionContext,
  ) {
    console.log(
        'Keep-alive started',
        controller.cron,
    )

    try {
      await keepSupabaseAlive(env)

      console.log(
          'Keep-alive succeeded',
      )
    } catch (error) {
      console.error(
          'Keep-alive failed:',
          error instanceof Error
              ? error.message
              : JSON.stringify(error),
      )
    }
  }
} satisfies ExportedHandler<Env>
import { z } from 'zod'

const joinGameMessageSchema = z
  .object({
    type: z.literal('JOIN_GAME'),
    playerId: z.string().uuid(),
    name: z.string().trim().min(1).max(30),
  })
  .strict()

const startGameMessageSchema = z
  .object({
    type: z.literal('START_GAME'),
  })
  .strict()

const endTurnMessageSchema = z
  .object({
    type: z.literal('END_TURN'),
  })
  .strict()

export const clientMessageSchema = z.discriminatedUnion('type', [
  joinGameMessageSchema,
  startGameMessageSchema,
  endTurnMessageSchema,
])
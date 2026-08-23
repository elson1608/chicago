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

const rollDiceMessageSchema = z
  .object({
    type: z.literal('ROLL_DICE'),
  })
  .strict()

const toggleDieHeldMessageSchema = z
  .object({
    type: z.literal('TOGGLE_DIE_HELD'),
    dieIndex: z.number().int().min(0).max(2),
  })
  .strict()

export const clientMessageSchema = z.discriminatedUnion('type', [
  joinGameMessageSchema,
  startGameMessageSchema,
  endTurnMessageSchema,
  rollDiceMessageSchema,
  toggleDieHeldMessageSchema
])
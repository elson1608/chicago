import { z } from 'zod'

const createRoomMessageSchema = z
  .object({
    type: z.literal('CREATE_ROOM'),
  })
  .strict()

const leaveRoomMessageSchema = z
  .object({
    type: z.literal('LEAVE_ROOM'),
  })
  .strict()

const joinRoomMessageSchema = z
  .object({
    type: z.literal('JOIN_ROOM'),
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
  createRoomMessageSchema,
  joinRoomMessageSchema,
  leaveRoomMessageSchema,
  startGameMessageSchema,
  endTurnMessageSchema,
  rollDiceMessageSchema,
  toggleDieHeldMessageSchema,
])
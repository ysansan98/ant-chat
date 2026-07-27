import { z } from 'zod'

export const CommandInterpreterSchema = z.enum([
  'bash',
  'powershell7',
  'windows-powershell',
  'cmd',
])

export const CommandMetadataSchema = z.object({
  interpreter: CommandInterpreterSchema,
}).strict()

export type CommandInterpreter = z.infer<typeof CommandInterpreterSchema>
export type CommandMetadata = z.infer<typeof CommandMetadataSchema>

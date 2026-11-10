export type Severity = 'ninguna' | 'leve' | 'importante'

export type Reflection = {
  turnId: string
  at: number
  status: 'pending' | 'done' | 'error'
  text?: string
  reason?: string
  tokens?: { input: number; output: number; cached: number }
}

/** `on` every answered turn, `herramientas` only turns that called a tool, `off` never. */
export type Mode = 'on' | 'herramientas' | 'off'

declare module 'claude-code' {
  interface PluginState {
    autocritica: { reflections: Shaped<Reflection[]>; mode: Mode }
  }
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mode, Reflection, Severity } from '../types'

const PANE = 'autocritica'
const TITLE = 'Autocrítica'
const KEEP = 10
const STALE_MS = 3 * 60_000
const MODES: readonly Mode[] = ['on', 'herramientas', 'off']

const reflections = atom({ plugin: 'autocritica', key: 'reflections' } as const, [], {
  shape: 'reflections-1',
})
const mode = atom({ plugin: 'autocritica', key: 'mode' } as const, 'on' as Mode)

const SECTIONS = [
  ['Decisiones y proceso', 'Qué decidiste y cómo llegaste a cada decisión.'],
  ['Inferencias y asunciones', 'Qué diste por hecho y por qué no preguntaste cuando tenías dudas.'],
  ['Qué debí preguntarte', 'Las preguntas concretas que deberías haber hecho al humano antes de actuar.'],
  ['Huecos rellenados', 'Datos o información que supusiste a tu criterio.'],
  ['Incoherencias', 'Contradicciones o errores en lo que dijiste o hiciste, incluidos errores de herramientas que ignoraste.'],
  ['Alternativas no exploradas', 'Caminos que podían haber sido interesantes.'],
  ['Qué eché en falta', 'Del humano, de las herramientas o de los recursos disponibles.'],
  ['Skills y plugins que influyeron', 'Qué skills, plugins, hooks o contexto inyectado marcaron el rumbo, y cómo.'],
] as const

const PROMPT = (answer: string, log: string[]) => `[Autocrítica del turno: petición de un plugin, no del usuario]
No tienes herramientas: responde ya, sin intentar usar ninguna. No te dirijas al usuario ni continúes la tarea.
Revisa con honestidad y de forma crítica el turno que acabas de terminar.

Registro de herramientas del turno (hechos; úsalo):
${log.length ? log.join('\n') : '(ninguna herramienta)'}

Tu respuesta final:
<respuesta>
${answer.slice(0, 4000)}
</respuesta>

Escribe en español, en markdown. Usa exactamente estos encabezados, cada uno seguido de " · " y su gravedad (ninguna, leve o importante), por ejemplo "### Incoherencias · leve". Debajo, viñetas breves y concretas que citen lo que hiciste. Escribe "Ninguna" (gravedad ninguna) donde no aplique; no inventes autocríticas para rellenar.
${SECTIONS.map(([t, d]) => `### ${t} · <gravedad>\n${d}`).join('\n')}
Máximo 400 palabras en total.`

type Section = { title: string; severity?: Severity; body: string }

// Splits the reply on its ### headings; a heading without a recognised severity keeps none.
export function parseSections(text: string): Section[] {
  const out: Section[] = []
  for (const chunk of text.split(/^###\s+/m).slice(1)) {
    const [head = '', ...rest] = chunk.split('\n')
    const m = /^(.*?)\s*·\s*(ninguna|leve|importante)\s*$/i.exec(head.trim())
    out.push({
      title: (m?.[1] ?? head).trim(),
      severity: m?.[2]?.toLowerCase() as Severity | undefined,
      body: rest.join('\n').trim(),
    })
  }
  return out
}

const COLOR: Record<Severity, string> = { ninguna: 'gray', leve: 'yellow', importante: 'red' }

// Module state: lost on reload, which only costs the current turn's log.
let turnLog: string[] = []
let busySince = 0

const clip = (s: string | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').slice(0, n)

const setOne = ($: EngineInterface, turnId: string, patch: Partial<Reflection>) =>
  update($, reflections, list => list.map(r => (r.turnId === turnId ? { ...r, ...patch } : r)))

async function reflect($: EngineInterface, turnId: string, answer: string, log: string[]) {
  try {
    const r = await $.model.fork({ prompt: PROMPT(answer, log) })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') {
      await update($, reflections, list => list.filter(x => x.turnId !== turnId))
      return
    }
    const u = 'usage' in r ? r.usage : undefined
    const tokens = u && {
      input: u.input_tokens + (u.cache_creation_input_tokens ?? 0),
      output: u.output_tokens,
      cached: u.cache_read_input_tokens ?? 0,
    }
    if (r.isAnswered) {
      await setOne($, turnId, { status: 'done', text: r.text, tokens })
      const serious = parseSections(r.text).filter(s => s.severity === 'importante')
      if (serious.length) $.ui.toast(`Autocrítica: importante en ${serious.map(s => s.title).join(', ')}`)
    } else {
      const reason = r.reason === 'api-error' ? `api-error ${r.status ?? 'sin respuesta'} (${r.error})` : r.reason
      $.ui.log(`fork sin texto: ${reason}`, { to: 'debug' })
      await setOne($, turnId, { status: 'error', reason, tokens })
    }
  } catch (err) {
    $.ui.log(`fork lanzó: ${String(err)}`, { to: "debug" })
    await setOne($, turnId, { status: 'error', reason: String(err) })
  } finally {
    busySince = 0
  }
}

// What the "Pásaselo a Claude" button puts in the prompt: every section that is not "ninguna".
export function followUp(text: string): string {
  const relevant = parseSections(text).filter(s => s.severity !== 'ninguna' && !/^ninguna\.?$/i.test(s.body))
  const body = relevant.length
    ? relevant.map(s => `**${s.title}**${s.severity ? ` (${s.severity})` : ''}\n${s.body}`).join('\n\n')
    : text
  return `Tu autocrítica del turno anterior detectó esto:\n\n${body}\n\nRevísalo: resuelve las incoherencias, hazme las preguntas que quedaron pendientes y corrige lo que dependa de suposiciones dudosas.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('mode')
    if (MODES.includes(saved as Mode)) await update($, mode, () => saved as Mode)
    await $.command.register({
      name: 'autocritica',
      description: 'Abre el pane de autocrítica; con on, off o herramientas cambia cuándo reflexiona',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'autocritica' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase() as Mode
    if (arg && !MODES.includes(arg)) return { text: `Uso: /autocritica [${MODES.join('|')}]` }
    if (arg) {
      await update($, mode, () => arg)
      await $.store.set('mode', arg)
      return { text: `Autocrítica: modo ${arg}.` }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Pane de autocrítica abierto.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) turnLog = []
    return next(e)
  })

  // Observes only: it never denies, so a failure here must not touch the call.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || turnLog.length >= 40) return r
    try {
      const name = e.tool === 'Skill' ? `Skill(${e.skill})` : e.tool
      if (r.deny !== undefined) turnLog.push(`- ${name}: DENEGADA: ${clip(r.deny, 200)}`)
      else if (r.isError) turnLog.push(`- ${name}: ERROR: ${clip(r.text, 200)}`)
      else turnLog.push(`- ${name}: ok`)
      for (const c of r.context ?? []) turnLog.push(`  · un hook inyectó contexto tras ${name}: ${clip(c, 200)}`)
    } catch {}

    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || e.reason !== 'answer') return next(e)
    const now = await $.clock.now()
    const m = await read($, mode)
    // A busy flag older than STALE_MS means its timer never ran: take the turn anyway.
    if (m === 'off' || (m === 'herramientas' && turnLog.length === 0) || now - busySince < STALE_MS) return next(e)
    busySince = now
    const log = turnLog
    await update($, reflections, list =>
      [...list.filter(r => r.status !== 'pending'), { turnId: e.turnId, at: now, status: 'pending' as const }].slice(-KEEP),
    )
    // A timer lets the turn end now instead of waiting on the fork.
    $.clock.after(0, () => void reflect($, e.turnId, e.answer, log))

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown, Button } = $.ui.resolve(e)
    const list = await read($, reflections)
    const m = await read($, mode)

    return (
      <Box flexDirection="column">
        <Text dimColor>Modo: {m} · /autocritica on|herramientas|off</Text>
        {list.length === 0 && <Text dimColor>Aún no hay turnos terminados.</Text>}
        {[...list].reverse().map(r => {
          const sections = r.text ? parseSections(r.text) : []
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>
                {new Date(r.at).toLocaleTimeString('es-ES')} · turno {r.turnId.slice(0, 8)}
                {r.status === 'pending' ? ' · reflexionando…' : ''}
                {r.tokens ? ` · ${r.tokens.input}↑ ${r.tokens.output}↓ ${r.tokens.cached} en caché` : ''}
              </Text>
              {r.status === 'done' && sections.length === 0 && <Markdown text={r.text ?? ''} />}
              {r.status === 'done' &&
                sections.map(s => (
                  <Box flexDirection="column">
                    <Text bold color={s.severity ? COLOR[s.severity] : undefined}>
                      {s.title}
                      {s.severity ? ` · ${s.severity}` : ''}
                    </Text>
                    {s.severity !== 'ninguna' && <Markdown text={s.body} />}
                  </Box>
                ))}
              {r.status === 'done' && (
                <Button key={`send-${r.turnId}`} onPress={() => void $.prompt.fill({ text: followUp(r.text ?? '') })}>
                  Pásaselo a Claude
                </Button>
              )}
              {r.status === 'error' && <Text color="red">Sin reflexión: {r.reason}</Text>}
            </Box>
          )
        })}
      </Box>
    )
  })
}

import { expect, test } from 'claude-code/testing'

import { followUp, parseSections } from '../hooks/register'

const PANE = {
  plugin: 'autocritica',
  component: 'Pane',
  requestId: 'autocritica',
  props: {
    title: 'Autocrítica',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const TEXT =
  '### Decisiones y proceso · leve\n- Elegí fork\n### Incoherencias · importante\n- Dije X e hice Y\n### Huecos rellenados · ninguna\nNinguna'

test('parseSections lee título y gravedad; followUp omite lo de gravedad ninguna', () => {
  expect(parseSections(TEXT).map(s => [s.title, s.severity])).toEqual([
    ['Decisiones y proceso', 'leve'],
    ['Incoherencias', 'importante'],
    ['Huecos rellenados', 'ninguna'],
  ])
  const ask = followUp(TEXT)
  expect(ask).toContain('Dije X e hice Y')
  expect(ask).not.toContain('Huecos rellenados')
})

test('el pane pinta los apartados y el botón rellena el prompt', async ($, on) => {
  on('state.get', (_, e) =>
    e.key === 'reflections'
      ? { value: { value: { shape: 'reflections-1', value: [{ turnId: 'abcdef123456', at: 0, status: 'done', text: TEXT }] }, version: 1 } }
      : { value: { value: undefined, version: 0 } },
  )
  let filled = ''
  on('prompt.fill', (_, e) => {
    filled = e.text
    return { isFilled: true }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Incoherencias · importante/ }))?.text).toBeDefined()
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Elegí fork')
  await ui.press({ key: 'send-abcdef123456' })
  expect(filled).toContain('Dije X e hice Y')
  await ui.unmount()
})

test('sin turnos muestra el aviso vacío', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Aún no/ }))?.text).toBe('Aún no hay turnos terminados.')
  await ui.unmount()
})

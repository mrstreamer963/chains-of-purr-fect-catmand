import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onMounted } from 'vue'
import { GAME_BALANCE, Simulation } from './core'
import App from './App.vue'

const VueFlowStub = {
  props: ['nodes', 'edges', 'isValidConnection'],
  emits: ['connect', 'init', 'edge-click', 'node-click'],
  setup(_props: unknown, { emit }: { emit: (event: string, value: unknown) => void }) {
    onMounted(() => {
      emit('init', {
        screenToFlowCoordinate: ({ x, y }: { x: number; y: number }) => ({
          x: (x - 264 + 160) / 1.25,
          y: (y - 82 - 50) / 1.25,
        }),
      })
    })
  },
  template: `
    <div class="flow-stub">
      <i
        v-for="node in nodes"
        :key="node.id"
        class="flow-node-stub"
        :data-node-id="node.id"
        :data-blocked="String(node.data.blocked)"
        :data-x="node.position.x"
        :data-y="node.position.y"
        @click="$emit('node-click', { node })"
      />
      <i
        v-for="edge in edges.filter((candidate) => isValidConnection(candidate))"
        :key="edge.id"
        class="flow-edge-stub"
        :data-edge-id="edge.id"
        :data-label="edge.label"
        @click="$emit('edge-click', { edge })"
      />
      <template v-for="node in nodes" :key="node.id + '-slots'">
        <button
          v-for="slot in node.data.node.slots"
          :key="slot.id"
          type="button"
          class="flow-slot-stub"
          :class="'slot-' + slot.id"
          :data-cat="slot.catId"
          :data-reserved="slot.reservedByCatId"
          :data-assigned="slot.assignedCatId"
          @click="node.data.onSlotClick(node.id, slot.id, slot.catId, slot.reservedByCatId, slot.assignedCatId)"
        />
      </template>
      <button
        class="connect-research-server"
        type="button"
        @click="$emit('connect', { source: 'research-1', target: 'server-2', sourceHandle: 'data-out', targetHandle: 'data-in' })"
      />
      <button
        class="connect-server-terminal"
        type="button"
        @click="$emit('connect', { source: 'server-2', target: 'terminal-3', sourceHandle: 'data-out', targetHandle: 'data-in' })"
      />
    </div>
  `,
}

describe('App economy controls', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size },
    }
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 264,
      y: 82,
      left: 264,
      top: 82,
      right: 1264,
      bottom: 782,
      width: 1000,
      height: 700,
      toJSON: () => ({}),
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  it('shows prices from GAME_BALANCE and reveals ×100 only through the brand mark', async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          VueFlow: VueFlowStub,
        },
      },
    })

    expect(wrapper.text()).not.toContain(`Торговый терминал · ${GAME_BALANCE.nodes.terminal.cost}.00`)
    expect(wrapper.find('.app-version').text()).toBe('v2.0.1')
    expect(wrapper.find('.science-readout').text()).toContain('0.00/ 0.00')
    expect(wrapper.find('.economy-readout strong').text()).toBe('1000.00')
    expect(wrapper.find('.expense-label').text()).toBe('РАСХОДЫ / МИН')
    expect(wrapper.find('.expense-line small').text()).toBe('−11.00')
    expect(wrapper.find('.research-project').text()).toContain('ВОЗДУШНАЯ ЭРА')
    expect(wrapper.find('.research-project__value').text()).toContain('0.00 / 50.00НАУКИ')
    expect(wrapper.find('.research-project__progress').attributes('aria-valuenow')).toBe('0')
    expect(wrapper.find('.objective-card').text()).toContain('АВТОНОМНАЯ ЛАБОРАТОРИЯ')
    expect(wrapper.find('.objective-card').text()).toContain('0 / 2')
    expect(wrapper.find('.objective-card').text()).toContain('0.00 / 500.00 /МИН')
    expect(wrapper.find('.objective-card').text()).toContain('0:00 / 5:00')
    expect(wrapper.find('.objective-timer__progress').attributes('aria-valuenow')).toBe('0')
    expect(wrapper.find('.objective-card__hint').text()).toContain('сбрасывается')
    expect(wrapper.findAll('.speed-button').map((button) => button.text())).toEqual(['Пауза', '×1.00', '×5.00', '×10.00'])
    await wrapper.find('.brand-mark').trigger('click')
    expect(wrapper.findAll('.speed-button').map((button) => button.text())).toEqual(['Пауза', '×1.00', '×5.00', '×10.00', '×100.00'])
    expect(wrapper.text()).not.toContain('Вернуть выбранного кота')
    expect(window.localStorage.getItem('catmand-save-v5')).toBeNull()
    wrapper.unmount()
  })

  it('reveals construction actions only when their prerequisites are useful', async () => {
    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    const constructionButton = (label: string) => wrapper.findAll('.action-button').find((button) => button.text().includes(`${label} ·`))

    expect(constructionButton('Комната отдыха')).toBeUndefined()
    expect(constructionButton('Исследования')).toBeDefined()
    expect(constructionButton('Сервер')).toBeUndefined()
    expect(constructionButton('Торговый терминал')).toBeUndefined()
    expect(constructionButton('Дорожный хаб')).toBeUndefined()

    await constructionButton('Исследования')!.trigger('click')
    expect(constructionButton('Сервер')).toBeDefined()
    expect(constructionButton('Торговый терминал')).toBeUndefined()
    expect(constructionButton('Дорожный хаб')).toBeUndefined()

    await constructionButton('Сервер')!.trigger('click')
    expect(constructionButton('Торговый терминал')).toBeDefined()
    expect(constructionButton('Дорожный хаб')).toBeDefined()

    await wrapper.find('.hire-button').trigger('click')
    await wrapper.find('.hire-button').trigger('click')
    expect(constructionButton('Комната отдыха')).toBeUndefined()
    await wrapper.find('.hire-button').trigger('click')
    expect(constructionButton('Комната отдыха')).toBeDefined()
    wrapper.unmount()
  })

  it('visualizes recurring upkeep by category and updates it after expansion', async () => {
    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })

    expect(wrapper.findAll('.expense-segment').map((segment) => segment.attributes('title'))).toEqual([
      'Комнаты отдыха: 6.00/мин',
      'Коты: 5.00/мин',
    ])

    await wrapper.findAll('.action-button').find((button) => button.text().includes('Исследования ·'))!.trigger('click')
    await wrapper.find('.hire-button').trigger('click')

    expect(wrapper.find('.expense-line small').text()).toBe('−28.00')
    expect(wrapper.find('.expense-segment--research').attributes('title')).toBe('Исследования: 12.00/мин')
    expect(wrapper.find('.expense-segment--cats').attributes('title')).toBe('Коты: 10.00/мин')
    expect(wrapper.find('.expense-bar').attributes('aria-label')).toContain('Расходы 28.00 в минуту')
    wrapper.unmount()
  })

  it('ignores the old local save key', () => {
    const legacy = new Simulation().exportSave() as unknown as { version: number; simulation: { scienceProgress: number } }
    legacy.version = 4
    legacy.simulation.scienceProgress = 49
    window.localStorage.setItem('catmand-save-v4', JSON.stringify(legacy))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    expect(wrapper.find('.science-readout strong').text()).toBe('0.00')
    expect(window.localStorage.getItem('catmand-save-v5')).toBeNull()
    wrapper.unmount()
  })

  it('shows research count and formats partial stable-profit progress', () => {
    const simulation = new Simulation()
    simulation.createNode('research')
    simulation.createNode('research')
    simulation.hireCat()
    simulation.hireCat()
    simulation.hireCat()
    const save = simulation.exportSave()
    save.simulation.flightUnlocked = true
    save.simulation.scienceProgress = GAME_BALANCE.science.flightUnlockProgress
    save.simulation.goal.profitableSeconds = GAME_BALANCE.objective.requiredProfitableSeconds - 0.1
    save.simulation.goal.peakNetIncomePerMinute = 612.34
    save.simulation.nodes.filter((node) => node.type === 'research').flatMap((node) => node.slots).forEach((slot, index) => { slot.assignedCatId = save.simulation.cats[index].id })
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(save))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    expect(wrapper.find('.objective-card').text()).toContain('2 / 2')
    expect(wrapper.find('.objective-card').text()).toContain('ВОЗДУШНАЯ ЭРАЗАВЕРШЕНА')
    expect(wrapper.find('.objective-card').text()).toContain('4:59 / 5:00')
    expect(wrapper.find('.objective-card').text()).toContain('ПИКОВАЯ ПРИБЫЛЬ612.34 / 500.00 /МИН')
    expect(wrapper.find('.objective-timer__progress').attributes('aria-valuenow')).toBe('299.9')
    expect(wrapper.findAll('.action-button').some((button) => button.text().includes('Дорожный хаб ·'))).toBe(false)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('pauses for an unacknowledged objective and resumes the persisted sandbox at ×1', async () => {
    const simulation = new Simulation()
    const save = simulation.exportSave()
    save.simulation.flightUnlocked = true
    save.simulation.scienceProgress = GAME_BALANCE.science.flightUnlockProgress
    save.simulation.goal = { achieved: true, acknowledged: false, profitableSeconds: GAME_BALANCE.objective.requiredProfitableSeconds, peakNetIncomePerMinute: GAME_BALANCE.objective.requiredPeakNetIncomePerMinute }
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(save))

    const wrapper = mount(App, { attachTo: document.body, global: { stubs: { VueFlow: VueFlowStub } } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.find('.goal-modal').text()).toContain('ЦЕЛЬ ДОСТИГНУТА')
    expect(wrapper.find('.goal-modal').text()).toContain('прибыль пять минут')
    expect(wrapper.find('.goal-modal').text()).toContain('500 кредитов в минуту')
    expect(wrapper.find('.speed-button--active').text()).toBe('Пауза')
    expect(document.activeElement).toBe(wrapper.find('.goal-modal button').element)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.speed-button--active').text()).toBe('Пауза')

    await wrapper.find('.goal-modal button').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.find('.speed-button--active').text()).toBe('×1.00')
    expect(wrapper.find('.objective-card__sandbox').text()).toContain('ПЕСОЧНИЦА ПРОДОЛЖАЕТСЯ')
    const persisted = JSON.parse(window.localStorage.getItem('catmand-save-v5')!)
    expect(persisted.simulation.goal).toEqual({ achieved: true, acknowledged: true, profitableSeconds: GAME_BALANCE.objective.requiredProfitableSeconds, peakNetIncomePerMinute: GAME_BALANCE.objective.requiredPeakNetIncomePerMinute })
    wrapper.unmount()

    const restoredWrapper = mount(App, { attachTo: document.body, global: { stubs: { VueFlow: VueFlowStub } } })
    expect(restoredWrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(restoredWrapper.find('.speed-button--active').text()).toBe('×1.00')
    restoredWrapper.unmount()
  })

  it('uses precise shared formatting for totals, credits, and road travel time', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)
    simulation.connectWorkerNodes('rest-1', research.value.id, 0.625)
    const save = simulation.exportSave()
    save.simulation.scienceProgress = 12.345
    save.simulation.nodes.find((node) => node.id === 'rest-1')!.dataBuffer = 0.25
    save.simulation.economy.credits = 999.255
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(save))

    const wrapper = mount(App, {
      global: { stubs: { VueFlow: VueFlowStub } },
    })

    expect(wrapper.find('.science-readout strong').text()).toBe('12.35')
    expect(wrapper.find('.science-readout em').text()).toBe('/ 0.25')
    expect(wrapper.find('.economy-readout strong').text()).toBe('999.26')
    expect(wrapper.find('[data-label="0.63с"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('lists every unassigned cat state, excludes assigned cats, and reuses cat selection', async () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)
    simulation.hireCat()
    simulation.hireCat()
    simulation.hireCat()
    simulation.tick(5)
    simulation.assignCat('cat-3', research.value.id, research.value.slots[0].id)
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(simulation.exportSave()))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    const roster = wrapper.find('.crew-roster-section')
    const buttons = roster.findAll('.crew-cat-button')
    expect(roster.find('.crew-roster-heading strong').text()).toBe('3')
    expect(buttons.map((button) => button.text())).toEqual(expect.arrayContaining([
      expect.stringContaining('Мираготов к работе'),
      expect.stringContaining('Ноксготов к работе'),
      expect.stringContaining('Инейждёт кресло'),
    ]))
    expect(roster.text()).not.toContain('Север')

    const noxButton = buttons.find((button) => button.text().includes('Нокс'))!
    await noxButton.trigger('click')
    expect(noxButton.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.graph-status').text()).toContain('Нокс выбран')
    await noxButton.trigger('click')
    expect(noxButton.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.graph-status').text()).toContain('Выбор кота отменён')

    await noxButton.trigger('click')
    await wrapper.find(`.slot-${research.value.slots[1].id}`).trigger('click')
    expect(wrapper.find('.crew-roster-heading strong').text()).toBe('2')
    expect(wrapper.find('.crew-roster-section').text()).not.toContain('Нокс')
    wrapper.unmount()
  })

  it('shows travelling and stranded cats without assignments', () => {
    const travellingSimulation = new Simulation()
    const travellingResearch = travellingSimulation.createNode('research')
    if (!travellingResearch.ok) throw new Error(travellingResearch.reason)
    travellingSimulation.connectWorkerNodes('rest-1', travellingResearch.value.id, 1)
    travellingSimulation.assignCat('cat-1', travellingResearch.value.id, travellingResearch.value.slots[0].id)
    travellingSimulation.tick(1)
    travellingSimulation.releaseCat('cat-1')
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(travellingSimulation.exportSave()))

    const travellingWrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    expect(travellingWrapper.find('.crew-cat-button').text()).toContain('в пути')
    travellingWrapper.unmount()

    const strandedSimulation = new Simulation()
    const strandedResearch = strandedSimulation.createNode('research')
    if (!strandedResearch.ok) throw new Error(strandedResearch.reason)
    const road = strandedSimulation.connectWorkerNodes('rest-1', strandedResearch.value.id, 1)
    if (!road.ok) throw new Error(road.reason)
    strandedSimulation.assignCat('cat-1', strandedResearch.value.id, strandedResearch.value.slots[0].id)
    strandedSimulation.tick(1)
    strandedSimulation.disconnectWorkerLink(road.value.id)
    strandedSimulation.releaseCat('cat-1')
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(strandedSimulation.exportSave()))

    const strandedWrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    expect(strandedWrapper.find('.crew-cat-button').text()).toContain('путь недоступен')
    strandedWrapper.unmount()
  })

  it('shows a neutral crew state when every cat has an assignment', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(simulation.exportSave()))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    expect(wrapper.find('.crew-roster-heading strong').text()).toBe('0')
    expect(wrapper.find('.crew-roster-empty').text()).toBe('ВСЕ КОТЫ НАЗНАЧЕНЫ')
    expect(wrapper.findAll('.crew-cat-button')).toHaveLength(0)
    wrapper.unmount()
  })

  it('controls simulation speed with Space and number shortcuts', async () => {
    const wrapper = mount(App, {
      global: { stubs: { VueFlow: VueFlowStub } },
    })

    const activeSpeed = () => wrapper.find('.speed-button--active').text()
    const press = async (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      window.dispatchEvent(event)
      await wrapper.vm.$nextTick()
      return event
    }

    expect(activeSpeed()).toBe('×1.00')
    await press('2')
    expect(activeSpeed()).toBe('×5.00')
    expect(wrapper.find('.graph-status').text()).toContain('×5.00')
    const firstSpaceEvent = await press(' ')
    expect(firstSpaceEvent.defaultPrevented).toBe(true)
    expect(activeSpeed()).toBe('Пауза')
    await press(' ')
    expect(activeSpeed()).toBe('×5.00')
    await press('3')
    expect(activeSpeed()).toBe('×10.00')
    await press('1')
    expect(activeSpeed()).toBe('×1.00')
    const spaceEvent = await press(' ')
    expect(spaceEvent.defaultPrevented).toBe(true)
    expect(activeSpeed()).toBe('Пауза')
    await press(' ')
    expect(activeSpeed()).toBe('×1.00')

    expect(wrapper.find('.speed-button').attributes('aria-keyshortcuts')).toBe('Space')
    expect(wrapper.findAll('.speed-button')[2].attributes('aria-keyshortcuts')).toBe('2')
    wrapper.unmount()
  })

  it('splits accelerated simulation time into bounded substeps', async () => {
    let animationFrame: FrameRequestCallback = () => undefined
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrame = callback
      return 1
    }))
    const tick = vi.spyOn(Simulation.prototype, 'tick')
    const wrapper = mount(App, {
      global: { stubs: { VueFlow: VueFlowStub } },
    })

    await wrapper.find('.brand-mark').trigger('click')
    await wrapper.findAll('.speed-button').at(-1)!.trigger('click')
    animationFrame(1_000)
    animationFrame(1_010)

    expect(tick).toHaveBeenCalledTimes(10)
    expect(tick.mock.calls.every(([deltaSeconds]) => deltaSeconds <= 0.1)).toBe(true)
    expect(tick.mock.calls.reduce((total, [deltaSeconds]) => total + deltaSeconds, 0)).toBeCloseTo(1)
    wrapper.unmount()
  })

  it('does not use speed shortcuts with modifiers or from editable controls', async () => {
    const wrapper = mount(App, {
      global: { stubs: { VueFlow: VueFlowStub } },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.speed-button--active').text()).toBe('×1.00')

    wrapper.find('input[type="file"]').element.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.speed-button--active').text()).toBe('×1.00')
    wrapper.unmount()
  })

  it('centers new nodes in the visible graph after pan and zoom and blocks overlaps', async () => {
    const wrapper = mount(App, {
      global: { stubs: { VueFlow: VueFlowStub } },
    })

    const constructionButton = (label: string) => wrapper.findAll('.action-button').find((button) => button.text().includes(`${label} ·`))
    await constructionButton('Исследования')!.trigger('click')
    const researchNode = wrapper.find('[data-node-id="research-1"]')
    expect(researchNode.attributes('data-x')).toBe('385')
    expect(researchNode.attributes('data-y')).toBe('130')

    await constructionButton('Сервер')!.trigger('click')
    await constructionButton('Дорожный хаб')!.trigger('click')
    const hubNode = wrapper.find('[data-node-id="hub-3"]')
    expect(hubNode.attributes('data-x')).toBe('490')
    expect(hubNode.attributes('data-y')).toBe('202')
    expect(researchNode.attributes('data-blocked')).toBe('true')
    expect(hubNode.attributes('data-blocked')).toBe('true')
    wrapper.unmount()

    const saved = JSON.parse(window.localStorage.getItem('catmand-save-v5')!)
    expect(saved.simulation.nodes.find((node: { id: string }) => node.id === 'research-1').position).toEqual({ x: 385, y: 130 })
    expect(saved.simulation.nodes.find((node: { id: string }) => node.id === 'hub-3').position).toEqual({ x: 490, y: 202 })
  })

  it('keeps module, connection, cat, and slot selections mutually exclusive', async () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    if (!research.ok || !server.ok) throw new Error('Missing selection setup')
    simulation.connect(research.value.id, server.value.id)
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(simulation.exportSave()))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    const module = wrapper.find(`[data-node-id="${research.value.id}"]`)
    const connection = wrapper.find('.flow-edge-stub')
    const emptySlot = wrapper.find(`.slot-${research.value.slots[0].id}`)
    const disconnectButton = () => wrapper.find('.action-button--disconnect')
    const deleteButton = () => wrapper.findAll('.action-button').find((button) => button.text().includes('Удалить выбранный модуль'))
    const catButton = wrapper.find('.crew-cat-button')

    expect(deleteButton()).toBeUndefined()
    expect(disconnectButton().exists()).toBe(false)

    await module.trigger('click')
    expect(deleteButton()).toBeDefined()
    expect(disconnectButton().exists()).toBe(false)

    await connection.trigger('click')
    expect(deleteButton()).toBeUndefined()
    expect(disconnectButton().exists()).toBe(true)

    await emptySlot.trigger('click')
    expect(disconnectButton().exists()).toBe(false)
    expect(wrapper.find('.graph-status').text()).toContain('Слот выбран')

    await module.trigger('click')
    expect(deleteButton()).toBeDefined()
    expect(wrapper.find('.graph-status').text()).toContain('Исследования выбран')

    await catButton.trigger('click')
    expect(deleteButton()).toBeUndefined()
    expect(catButton.attributes('aria-pressed')).toBe('true')

    await connection.trigger('click')
    expect(catButton.attributes('aria-pressed')).toBe('false')
    expect(disconnectButton().exists()).toBe(true)

    await module.trigger('click')
    expect(disconnectButton().exists()).toBe(false)
    expect(deleteButton()).toBeDefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(deleteButton()).toBeUndefined()
    expect(wrapper.find('.graph-status').text()).toContain('Выбор отменён')
    wrapper.unmount()
  })

  it('selects a working cat first, supports Escape, and then transfers it directly to another module', async () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing transfer setup')
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'north', 'road')
    simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'east', 'road')
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.tick(2)
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(simulation.exportSave()))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    const sourceSelector = `.slot-${research.value.slots[0].id}`
    const targetSelector = `.slot-${server.value.slots[0].id}`

    await wrapper.find(sourceSelector).trigger('click')
    expect(wrapper.find('.graph-status').text()).toContain('Выберите новое рабочее место')
    expect(wrapper.find(sourceSelector).attributes('data-cat')).toBe('cat-1')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.graph-status').text()).toContain('отменён')
    expect(wrapper.find(sourceSelector).attributes('data-cat')).toBe('cat-1')

    await wrapper.find(sourceSelector).trigger('click')
    await wrapper.find(targetSelector).trigger('click')
    expect(wrapper.find(sourceSelector).attributes('data-cat')).toBeUndefined()
    expect(wrapper.find(sourceSelector).attributes('data-assigned')).toBeUndefined()
    expect(wrapper.find(targetSelector).attributes('data-assigned')).toBe('cat-1')
    expect(wrapper.find(targetSelector).attributes('data-reserved')).toBe('cat-1')
    expect(wrapper.find('.graph-status').text()).toContain('идёт к модулю')
    wrapper.unmount()
  })

  it('sends a selected worker to rest on the second click of its source slot', async () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)
    simulation.connectWorkerNodes('rest-1', research.value.id, 1)
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.tick(1)
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(simulation.exportSave()))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    const sourceSelector = `.slot-${research.value.slots[0].id}`
    await wrapper.find(sourceSelector).trigger('click')
    await wrapper.find(sourceSelector).trigger('click')

    expect(wrapper.find(sourceSelector).attributes('data-cat')).toBeUndefined()
    expect(wrapper.find(sourceSelector).attributes('data-assigned')).toBeUndefined()
    expect(wrapper.findAll('.flow-slot-stub').some((slot) => slot.attributes('data-reserved') === 'cat-1')).toBe(true)
    expect(wrapper.find('.graph-status').text()).toContain('снят с работы')
    wrapper.unmount()
  })

  it('selects a resting assignment, replaces another cat selection, and clears it on repeat', async () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)
    simulation.connectWorkerNodes('rest-1', research.value.id, 1)
    simulation.hireCat()
    simulation.assignCat('cat-2', research.value.id, research.value.slots[0].id)
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(simulation.exportSave()))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    const sourceSelector = `.slot-${research.value.slots[0].id}`
    await wrapper.find('.slot-rest-1-slot-1').trigger('click')
    expect(wrapper.find('.graph-status').text()).toContain('Мира выбран')

    await wrapper.find(sourceSelector).trigger('click')
    expect(wrapper.find('.graph-status').text()).toContain('Нокс выбран')
    expect(wrapper.find(sourceSelector).attributes('data-assigned')).toBe('cat-2')

    await wrapper.find(sourceSelector).trigger('click')
    expect(wrapper.find(sourceSelector).attributes('data-assigned')).toBeUndefined()
    expect(wrapper.find('.graph-status').text()).toContain('больше не закреплён')
    wrapper.unmount()
  })

  it('selects and cancels an active work destination on the repeated click', async () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)
    simulation.connectWorkerNodes('rest-1', research.value.id, 4)
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(simulation.exportSave()))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    const targetSelector = `.slot-${research.value.slots[0].id}`
    await wrapper.find(targetSelector).trigger('click')
    expect(wrapper.find('.graph-status').text()).toContain('новую рабочую цель')
    expect(wrapper.find(targetSelector).attributes('data-reserved')).toBe('cat-1')

    await wrapper.find(targetSelector).trigger('click')
    expect(wrapper.find(targetSelector).attributes('data-reserved')).toBeUndefined()
    expect(wrapper.find(targetSelector).attributes('data-assigned')).toBeUndefined()
    expect(wrapper.find('.slot-rest-1-slot-1').attributes('data-cat')).toBe('cat-1')
    expect(wrapper.find('.graph-status').text()).toContain('возвращается отдыхать')
    wrapper.unmount()
  })

  it('redirects a cat selected through its active work destination', async () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing redirect setup')
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'north', 'road')
    simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'east', 'road')
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(simulation.exportSave()))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    const oldTarget = `.slot-${research.value.slots[0].id}`
    const newTarget = `.slot-${server.value.slots[0].id}`
    await wrapper.find(oldTarget).trigger('click')
    await wrapper.find(newTarget).trigger('click')

    expect(wrapper.find(oldTarget).attributes('data-assigned')).toBeUndefined()
    expect(wrapper.find(oldTarget).attributes('data-reserved')).toBeUndefined()
    expect(wrapper.find(newTarget).attributes('data-assigned')).toBe('cat-1')
    expect(wrapper.find(newTarget).attributes('data-reserved')).toBe('cat-1')
    expect(wrapper.find('.graph-status').text()).toContain('идёт к модулю')
    wrapper.unmount()
  })

  it('keeps a return-to-rest target while assigning the selected cat future work', async () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing future-work setup')
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'north', 'road')
    simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'east', 'road')
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.tick(2)
    simulation.releaseCat('cat-1')
    window.localStorage.setItem('catmand-save-v5', JSON.stringify(simulation.exportSave()))

    const wrapper = mount(App, { global: { stubs: { VueFlow: VueFlowStub } } })
    const restTarget = '.slot-rest-1-slot-1'
    const futureWork = `.slot-${server.value.slots[0].id}`
    await wrapper.find(restTarget).trigger('click')
    await wrapper.find(restTarget).trigger('click')
    expect(wrapper.find(restTarget).attributes('data-reserved')).toBe('cat-1')
    expect(wrapper.find('.graph-status').text()).toContain('продолжает путь на отдых')

    await wrapper.find(futureWork).trigger('click')
    expect(wrapper.find(restTarget).attributes('data-reserved')).toBe('cat-1')
    expect(wrapper.find(futureWork).attributes('data-assigned')).toBe('cat-1')
    expect(wrapper.find(futureWork).attributes('data-reserved')).toBeUndefined()
    expect(wrapper.find('.graph-status').text()).toContain('после отдыха')
    wrapper.unmount()
  })
})

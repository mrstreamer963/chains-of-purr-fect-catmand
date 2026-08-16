import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import GameNode from './GameNode.vue'

describe('GameNode', () => {
  it('renders node metrics and exposes worker-slot interaction', async () => {
    const onSlotClick = vi.fn()
    const wrapper = mount(GameNode, {
      props: {
        id: 'research-1',
        type: 'game',
        selected: false,
        connectable: true,
        position: { x: 0, y: 0 },
        dimensions: { width: 0, height: 0 },
        dragging: false,
        resizing: false,
        zIndex: 0,
        events: {} as any,
        data: {
          node: { id: 'research-1', type: 'research', name: 'Исследования', slots: [{ id: 'slot-1', catId: null, reservedByCatId: null, assignedCatId: null }, { id: 'slot-2', catId: null, reservedByCatId: null, assignedCatId: null }], dataBuffer: 1.25, dataStored: 0, productionRate: 1, inputRate: 0 , dataSold: 0, outputRate: 0},
          cats: {},
          restWaitingCats: [],
          selectedCatId: null,
          selectedSlotId: null,
          onCatClick: vi.fn(),
          onSlotClick,
        },
      },
      global: { stubs: { Handle: true } },
    })
    expect(wrapper.text()).toContain('Выработка')
    expect(wrapper.text()).toContain('1.25')
    expect(wrapper.find('.worker-slot').attributes('aria-label')).toContain('Место 1, Исследования: свободно')
    await wrapper.find('.worker-slot').trigger('click')
    expect(onSlotClick).toHaveBeenCalledWith('research-1', 'slot-1', null, null, null)
  })

  it('highlights only seated rest cats without a work assignment', () => {
    const wrapper = mount(GameNode, {
      props: {
        id: 'rest-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: {
            id: 'rest-1', type: 'rest', name: 'Комната отдыха',
            slots: [
              { id: 'rest-1-slot-1', catId: 'cat-1', reservedByCatId: null, assignedCatId: null },
              { id: 'rest-1-slot-2', catId: 'cat-2', reservedByCatId: null, assignedCatId: null },
            ],
            dataBuffer: 0, dataStored: 0, productionRate: 0, inputRate: 0, dataSold: 0, outputRate: 0,
          },
          cats: {
            'cat-1': { id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'rest-1', slotId: 'rest-1-slot-1', status: 'idle', travel: null, vigor: 100 },
            'cat-2': { id: 'cat-2', name: 'Нокс', variant: '◔', nodeId: 'rest-1', slotId: 'rest-1-slot-2', status: 'idle', travel: null, vigor: 50 },
          },
          unassignedCatIds: ['cat-1'],
          restWaitingCats: [],
          selectedCatId: null, selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })

    const seats = wrapper.findAll('.worker-slot')
    expect(seats[0].classes()).toContain('worker-slot--unassigned')
    expect(seats[0].text()).toContain('без работы')
    expect(seats[1].classes()).not.toContain('worker-slot--unassigned')
    expect(wrapper.findAll('.slot-state--unassigned')).toHaveLength(1)
  })

  it('marks an exhausted worker without a route to rest', () => {
    const wrapper = mount(GameNode, {
      props: {
        id: 'research-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: { id: 'research-1', type: 'research', name: 'Исследования', slots: [{ id: 'slot-1', catId: 'cat-1', reservedByCatId: null, assignedCatId: 'cat-1' }], dataBuffer: 0, dataStored: 0, productionRate: 0, inputRate: 0 , dataSold: 0, outputRate: 0},
          cats: { 'cat-1': { id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'research-1', slotId: 'slot-1', status: 'idle', travel: null, vigor: 0 } },
          restWaitingCats: [],
          selectedCatId: null, selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })
    expect(wrapper.find('.worker-slot').classes()).toContain('worker-slot--exhausted')
    expect(wrapper.text()).toContain('отдых недоступен')
  })

  it('exposes two-step selection from an occupied work slot while keeping the cat name selectable', async () => {
    const onCatClick = vi.fn()
    const onSlotClick = vi.fn()
    const wrapper = mount(GameNode, {
      props: {
        id: 'research-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: { id: 'research-1', type: 'research', name: 'Исследования', slots: [{ id: 'slot-1', catId: 'cat-1', reservedByCatId: null, assignedCatId: 'cat-1' }], dataBuffer: 0, dataStored: 0, productionRate: 1, inputRate: 0, dataSold: 0, outputRate: 0 },
          cats: { 'cat-1': { id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'research-1', slotId: 'slot-1', status: 'idle', travel: null, vigor: 74.25 } },
          restWaitingCats: [], selectedCatId: 'cat-1', selectedSlotId: null, onCatClick, onSlotClick,
        },
      },
      global: { stubs: { Handle: true } },
    })

    expect(wrapper.find('.worker-slot').classes()).toContain('worker-slot--selected')
    expect(wrapper.find('.cat-vigor').text()).toBe('75')
    expect(wrapper.find('.worker-slot').attributes('title')).toContain('Повторный клик')
    await wrapper.find('.worker-slot').trigger('click')
    expect(onSlotClick).toHaveBeenCalledWith('research-1', 'slot-1', 'cat-1', null, 'cat-1')

    await wrapper.find('.cat-name').trigger('click')
    expect(onCatClick).toHaveBeenCalledWith('cat-1')
    expect(onSlotClick).toHaveBeenCalledTimes(1)
  })

  it('highlights and explains an indirect slot for the selected assigned cat', async () => {
    const onSlotClick = vi.fn()
    const wrapper = mount(GameNode, {
      props: {
        id: 'research-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: { id: 'research-1', type: 'research', name: 'Исследования', slots: [{ id: 'slot-1', catId: null, reservedByCatId: null, assignedCatId: 'cat-1' }], dataBuffer: 0, dataStored: 0, productionRate: 0, inputRate: 0, dataSold: 0, outputRate: 0 },
          cats: { 'cat-1': { id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'rest-1', slotId: 'rest-1-slot-1', status: 'idle', travel: null, vigor: 50 } },
          restWaitingCats: [], selectedCatId: 'cat-1', selectedSlotId: null, onCatClick: vi.fn(), onSlotClick,
        },
      },
      global: { stubs: { Handle: true } },
    })

    expect(wrapper.find('.worker-slot').classes()).toContain('worker-slot--selected')
    expect(wrapper.find('.worker-slot').attributes('title')).toContain('снимет рабочее назначение')
    await wrapper.find('.worker-slot').trigger('click')
    expect(onSlotClick).toHaveBeenCalledWith('research-1', 'slot-1', null, null, 'cat-1')
  })

  it('highlights a selected reserved cat and distinguishes work and rest destinations', () => {
    const cats = { 'cat-1': { id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'rest-1', slotId: null, status: 'travelling' as const, travel: null, vigor: 100 } }
    const workWrapper = mount(GameNode, {
      props: {
        id: 'research-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: { id: 'research-1', type: 'research', name: 'Исследования', slots: [{ id: 'slot-1', catId: null, reservedByCatId: 'cat-1', assignedCatId: 'cat-1' }], dataBuffer: 0, dataStored: 0, productionRate: 0, inputRate: 0, dataSold: 0, outputRate: 0 },
          cats, restWaitingCats: [], selectedCatId: 'cat-1', selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })
    const restWrapper = mount(GameNode, {
      props: {
        id: 'rest-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: { id: 'rest-1', type: 'rest', name: 'Комната отдыха', slots: [{ id: 'rest-1-slot-1', catId: null, reservedByCatId: 'cat-1', assignedCatId: null }], dataBuffer: 0, dataStored: 0, productionRate: 0, inputRate: 0, dataSold: 0, outputRate: 0 },
          cats, restWaitingCats: [], selectedCatId: 'cat-1', selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })

    expect(workWrapper.find('.worker-slot').classes()).toContain('worker-slot--selected')
    expect(workWrapper.find('.worker-slot').attributes('title')).toContain('отменит цель')
    expect(restWrapper.find('.worker-slot').classes()).toContain('worker-slot--selected')
    expect(restWrapper.find('.worker-slot').attributes('title')).toContain('будущего назначения')
  })

  it('renders a stranded cat at an ordinary module', () => {
    const wrapper = mount(GameNode, {
      props: {
        id: 'research-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: { id: 'research-1', type: 'research', name: 'Исследования', slots: [{ id: 'slot-1', catId: null, reservedByCatId: null, assignedCatId: null }], dataBuffer: 0, dataStored: 0, productionRate: 0, inputRate: 0 , dataSold: 0, outputRate: 0},
          cats: { 'cat-1': { id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'research-1', slotId: null, status: 'stranded', travel: null, stranded: { targetNodeId: 'rest-1', targetSlotId: 'rest-1-slot-1', sourceNodeId: 'server-1' }, vigor: 0 } },
          restWaitingCats: [],
          strandedCats: [{ id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'research-1', slotId: null, status: 'stranded', travel: null, stranded: { targetNodeId: 'rest-1', targetSlotId: 'rest-1-slot-1', sourceNodeId: 'server-1' }, vigor: 0 }],
          selectedCatId: null, selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })
    expect(wrapper.find('.stranded-cats').text()).toBe('◕ Мира · путь недоступен')
  })

  it('marks an assigned cat red when it cannot reach the work slot', () => {
    const wrapper = mount(GameNode, {
      props: {
        id: 'research-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: { id: 'research-1', type: 'research', name: 'Исследования', slots: [{ id: 'slot-1', catId: null, reservedByCatId: null, assignedCatId: 'cat-1' }], dataBuffer: 0, dataStored: 0, productionRate: 0, inputRate: 0 , dataSold: 0, outputRate: 0},
          cats: { 'cat-1': { id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'rest-1', slotId: 'rest-1-slot-1', status: 'idle', travel: null, vigor: 100 } },
          restWaitingCats: [],
          selectedCatId: null, selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })
    expect(wrapper.find('.worker-slot').classes()).toContain('worker-slot--unreachable')
    expect(wrapper.text()).toContain('путь недоступен')
  })

  it('shows an alert on a resting cat that cannot reach its assigned work', () => {
    const wrapper = mount(GameNode, {
      props: {
        id: 'rest-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: { id: 'rest-1', type: 'rest', name: 'Комната отдыха', slots: [{ id: 'rest-1-slot-1', catId: 'cat-1', reservedByCatId: null, assignedCatId: null }], dataBuffer: 0, dataStored: 0, productionRate: 0, inputRate: 0 , dataSold: 0, outputRate: 0},
          cats: { 'cat-1': { id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'rest-1', slotId: 'rest-1-slot-1', status: 'idle', travel: null, vigor: 100 } },
          unreachableCatIds: ['cat-1'],
          restWaitingCats: [],
          selectedCatId: null, selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })
    expect(wrapper.find('.cat-route-warning').text()).toBe('!')
  })

  it('renders a compact road hub and its stranded-cat warning', () => {
    const wrapper = mount(GameNode, {
      props: {
        id: 'hub-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: { id: 'hub-1', type: 'hub', name: 'Дорожный хаб', slots: [], dataBuffer: 0, dataStored: 0, productionRate: 0, inputRate: 0 , dataSold: 0, outputRate: 0},
          cats: { 'cat-1': { id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'hub-1', slotId: null, status: 'stranded', travel: null, stranded: { targetNodeId: 'research-1', targetSlotId: 'slot-1', sourceNodeId: 'rest-1' }, vigor: 100 } },
          restWaitingCats: [],
          strandedCats: [{ id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'hub-1', slotId: null, status: 'stranded', travel: null, stranded: { targetNodeId: 'research-1', targetSlotId: 'slot-1', sourceNodeId: 'rest-1' }, vigor: 100 }],
          selectedCatId: null, selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })
    expect(wrapper.text()).toContain('ДОРОЖНЫЙ ХАБ')
    expect(wrapper.text()).toContain('Мира · путь недоступен')
    expect(wrapper.findAll('handle-stub')).toHaveLength(8)
  })

  it('marks an overlapping module as blocked and disables its slots', () => {
    const wrapper = mount(GameNode, {
      props: {
        id: 'research-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          blocked: true,
          node: { id: 'research-1', type: 'research', name: 'Исследования', slots: [{ id: 'slot-1', catId: null, reservedByCatId: null, assignedCatId: null }], dataBuffer: 0, dataStored: 0, productionRate: 0, inputRate: 0 , dataSold: 0, outputRate: 0},
          cats: {}, restWaitingCats: [], selectedCatId: null, selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })
    expect(wrapper.find('.game-node').classes()).toContain('game-node--blocked')
    expect(wrapper.find('.worker-slot').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('ПЕРЕКРЫТИЕ')
  })

  it('renders a trade terminal with one data input and only the current sale rate', () => {
    const wrapper = mount(GameNode, {
      props: {
        id: 'terminal-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: {
            id: 'terminal-1', type: 'terminal', name: 'Торговый терминал',
            slots: [{ id: 'terminal-1-slot-1', catId: null, reservedByCatId: null, assignedCatId: null }],
            dataBuffer: 0, dataStored: 0, dataSold: 12.5, productionRate: 0, inputRate: 0.25, outputRate: 0,
          },
          cats: {}, restWaitingCats: [], selectedCatId: null, selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })

    expect(wrapper.text()).toContain('Торговый терминал')
    expect(wrapper.text()).toContain('Продажа')
    expect(wrapper.text()).toContain('0.25')
    expect(wrapper.text()).not.toContain('Продано')
    expect(wrapper.text()).not.toContain('12.5')
    expect(wrapper.find('.node-metrics').classes()).toContain('node-metrics--single')
    expect(wrapper.findAll('handle-stub')).toHaveLength(3)
  })

  it('formats server throughput and storage without losing meaningful precision', () => {
    const wrapper = mount(GameNode, {
      props: {
        id: 'server-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: {
            id: 'server-1', type: 'server', name: 'Сервер данных',
            slots: [{ id: 'server-1-slot-1', catId: null, reservedByCatId: null, assignedCatId: null }],
            dataBuffer: 0, dataStored: 1.256, dataSold: 0, productionRate: 0, inputRate: 0.25, outputRate: 0.5,
          },
          cats: {}, restWaitingCats: [], selectedCatId: null, selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })

    expect(wrapper.find('.node-metrics').text()).toContain('0.25 / 0.50')
    expect(wrapper.find('.node-metrics').text()).toContain('1.26')
  })

  it('formats vigor precisely for cats waiting for a rest seat', () => {
    const waitingCat = { id: 'cat-1', name: 'Мира', variant: '◕', nodeId: 'rest-1', slotId: null, status: 'idle' as const, travel: null, vigor: 33.333 }
    const wrapper = mount(GameNode, {
      props: {
        id: 'rest-1', type: 'game', selected: false, connectable: true, position: { x: 0, y: 0 }, dimensions: { width: 0, height: 0 }, dragging: false, resizing: false, zIndex: 0, events: {} as any,
        data: {
          node: { id: 'rest-1', type: 'rest', name: 'Комната отдыха', slots: [], dataBuffer: 0, dataStored: 0, dataSold: 0, productionRate: 0, inputRate: 0, outputRate: 0 },
          cats: { 'cat-1': waitingCat }, restWaitingCats: [waitingCat], selectedCatId: null, selectedSlotId: null, onCatClick: vi.fn(), onSlotClick: vi.fn(),
        },
      },
      global: { stubs: { Handle: true } },
    })

    expect(wrapper.find('.rest-waiting__cat').text()).toContain('34')
  })
})

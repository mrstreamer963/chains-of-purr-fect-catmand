import { describe, expect, it } from 'vitest'
import { GAME_BALANCE } from './balance'
import { Simulation } from './simulation'
import type { WorkerLink } from './types'

function node(simulation: Simulation, type: 'rest' | 'research' | 'server' | 'hub' | 'terminal') {
  const result = simulation.snapshot().nodes.find((candidate) => candidate.type === type)
  if (!result) throw new Error(`Missing ${type}`)
  return result
}

function fundedSimulation(credits = 10_000) {
  const simulation = new Simulation()
  const save = simulation.exportSave()
  save.simulation.economy.credits = credits
  const restored = Simulation.fromSave(save)
  if (!restored.ok) throw new Error(restored.reason)
  return restored.value
}

function cat(simulation: Simulation, id = 'cat-1') {
  const result = simulation.snapshot().cats.find((candidate) => candidate.id === id)
  if (!result) throw new Error(`Missing ${id}`)
  return result
}

function createResearch(simulation: Simulation) {
  const research = simulation.createNode('research')
  if (!research.ok) throw new Error(research.reason)
  const link = simulation.connectWorkerNodes('rest-1', research.value.id, 1)
  if (!link.ok) throw new Error(link.reason)
  return research.value
}

function addLegacyWorkerLink(simulation: Simulation, link: WorkerLink) {
  const state = simulation as unknown as { workerLinks: Map<string, WorkerLink> }
  state.workerLinks.set(link.id, link)
}

describe('Simulation rest seating', () => {
  it('allows a research module to connect to multiple data servers', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const firstServer = simulation.createNode('server')
    const secondServer = simulation.createNode('server')
    if (!research.ok || !firstServer.ok || !secondServer.ok) throw new Error('Missing work node')

    expect(simulation.connect(research.value.id, firstServer.value.id)).toMatchObject({ ok: true })
    expect(simulation.connect(research.value.id, secondServer.value.id)).toMatchObject({ ok: true })
    expect(simulation.snapshot().connections).toEqual([
      expect.objectContaining({ sourceId: research.value.id, targetId: firstServer.value.id }),
      expect.objectContaining({ sourceId: research.value.id, targetId: secondServer.value.id }),
    ])
    expect(simulation.connect(research.value.id, firstServer.value.id)).toMatchObject({ ok: false, reason: expect.stringContaining('уже существует') })
  })

  it('allows creating every building type more than once', () => {
    const simulation = fundedSimulation()

    for (const type of ['rest', 'research', 'server'] as const) {
      expect(simulation.createNode(type).ok).toBe(true)
      expect(simulation.createNode(type).ok).toBe(true)
    }

    expect(simulation.snapshot().nodes.filter((candidate) => candidate.type === 'rest')).toHaveLength(3)
    expect(simulation.snapshot().nodes.filter((candidate) => candidate.type === 'research')).toHaveLength(2)
    expect(simulation.snapshot().nodes.filter((candidate) => candidate.type === 'server')).toHaveLength(2)
  })

  it('allows creating additional rest rooms and seats waiting cats in them', () => {
    const simulation = new Simulation()
    simulation.hireCat()
    simulation.hireCat()
    simulation.hireCat()

    const rest = simulation.createNode('rest')
    if (!rest.ok) throw new Error(rest.reason)

    expect(rest).toMatchObject({ ok: true, value: { type: 'rest', name: 'Комната отдыха' } })
    simulation.tick(0)
    expect(cat(simulation, 'cat-4')).toMatchObject({ nodeId: rest.value.id, slotId: `${rest.value.id}-slot-1` })
  })

  it('deletes an unused module and all of its links', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    if (!research.ok || !server.ok) throw new Error('Missing work node')
    const workerLink = simulation.connectWorkerNodes('rest-1', research.value.id, 1)
    if (!workerLink.ok) throw new Error(workerLink.reason)
    simulation.connect(research.value.id, server.value.id)

    expect(simulation.deleteNode(research.value.id)).toMatchObject({ ok: true })
    expect(simulation.snapshot()).toMatchObject({
      nodes: expect.not.arrayContaining([expect.objectContaining({ id: research.value.id })]),
      connections: [],
      workerLinks: [],
    })
  })

  it('evacuates cats from a removed occupied module and keeps the base rest room', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)
    simulation.connectWorkerNodes('rest-1', research.value.id, 2)
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.tick(2)

    expect(simulation.deleteNode(research.value.id)).toMatchObject({ ok: true })
    expect(cat(simulation)).toMatchObject({ nodeId: 'rest-1', slotId: 'rest-1-slot-1', status: 'idle', travel: null, stranded: null })
    expect(JSON.stringify(simulation.snapshot())).not.toContain(research.value.id)
    expect(simulation.deleteNode('rest-1')).toMatchObject({ ok: false, reason: expect.stringContaining('Базовую') })
  })

  it('evacuates a cat whose target is removed to the deterministic nearest rest seat and clears references', () => {
    const simulation = new Simulation()
    const firstRest = simulation.createNode('rest')
    const secondRest = simulation.createNode('rest')
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    if (!firstRest.ok || !secondRest.ok || !research.ok || !server.ok) throw new Error('Missing evacuation setup')

    simulation.setNodePosition('rest-1', { x: 0, y: 0 })
    simulation.setNodePosition(firstRest.value.id, { x: 50, y: 10 })
    simulation.setNodePosition(secondRest.value.id, { x: 50, y: -10 })
    simulation.setNodePosition(research.value.id, { x: 100, y: 0 })
    simulation.connect(research.value.id, server.value.id)
    expect(simulation.connectWorkerNodes('rest-1', research.value.id, 10).ok).toBe(true)
    expect(simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id).ok).toBe(true)
    simulation.tick(5)

    expect(simulation.deleteNode(research.value.id)).toMatchObject({ ok: true })
    expect(cat(simulation)).toMatchObject({
      nodeId: firstRest.value.id,
      slotId: firstRest.value.slots[0].id,
      status: 'idle',
      travel: null,
      stranded: null,
    })
    expect(JSON.stringify(simulation.snapshot())).not.toContain(research.value.id)
  })

  it('queues every evacuated cat at the base rest room when all rest seats are occupied', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.hireCat()
    simulation.tick(5)
    expect(simulation.assignCat('cat-1', research.id, research.slots[0].id).ok).toBe(true)
    expect(simulation.assignCat('cat-2', research.id, research.slots[1].id).ok).toBe(true)
    simulation.tick(1)
    simulation.hireCat()
    simulation.hireCat()
    simulation.hireCat()
    expect(node(simulation, 'rest').slots.every((slot) => slot.catId)).toBe(true)

    expect(simulation.deleteNode(research.id)).toMatchObject({ ok: true })
    expect(cat(simulation, 'cat-1')).toMatchObject({ nodeId: 'rest-1', slotId: null, status: 'idle', travel: null, stranded: null })
    expect(cat(simulation, 'cat-2')).toMatchObject({ nodeId: 'rest-1', slotId: null, status: 'idle', travel: null, stranded: null })
    expect(JSON.stringify(simulation.snapshot())).not.toContain(research.id)
  })

  it('reroutes a road traveller after deleting its next legacy ordinary-module endpoint', () => {
    const simulation = new Simulation()
    const intermediate = simulation.createNode('server')
    const first = simulation.createNode('hub')
    const detour = simulation.createNode('hub')
    const last = simulation.createNode('hub')
    const research = simulation.createNode('research')
    if (!intermediate.ok || !first.ok || !detour.ok || !last.ok || !research.ok) throw new Error('Missing reroute setup')

    simulation.connect(research.value.id, intermediate.value.id)
    expect(simulation.connectWorkerNodes('rest-1', first.value.id, 1, 'road', 'west').ok).toBe(true)
    expect(simulation.connectWorkerNodes(first.value.id, intermediate.value.id, 1, 'north', 'road').ok).toBe(true)
    expect(simulation.connectWorkerNodes(first.value.id, detour.value.id, 4, 'east', 'west').ok).toBe(true)
    expect(simulation.connectWorkerNodes(detour.value.id, last.value.id, 4, 'east', 'west').ok).toBe(true)
    expect(simulation.connectWorkerNodes(last.value.id, research.value.id, 1, 'east', 'road').ok).toBe(true)
    addLegacyWorkerLink(simulation, {
      id: `legacy-${intermediate.value.id}-${last.value.id}`,
      nodeAId: intermediate.value.id,
      nodeBId: last.value.id,
      nodeAPort: 'road',
      nodeBPort: 'north',
      travelSeconds: 1,
    })

    expect(simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id).ok).toBe(true)
    simulation.tick(1.5)
    expect(cat(simulation).travel).toMatchObject({ kind: 'road', leg: { toNodeId: intermediate.value.id } })

    expect(simulation.deleteNode(intermediate.value.id)).toMatchObject({ ok: true })
    expect(cat(simulation)).toMatchObject({ nodeId: first.value.id, status: 'travelling', stranded: null })
    expect(cat(simulation).travel).toMatchObject({
      kind: 'road',
      targetNodeId: research.value.id,
      leg: { toNodeId: detour.value.id },
    })
    expect(node(simulation, 'research').slots[0]).toMatchObject({ assignedCatId: 'cat-1', reservedByCatId: 'cat-1' })
    expect(JSON.stringify(simulation.snapshot())).not.toContain(intermediate.value.id)
  })

  it('starts with common seats, while new hires begin tired', () => {
    const simulation = new Simulation()
    expect(node(simulation, 'rest').slots).toHaveLength(3)
    expect(node(simulation, 'rest').slots.every((slot) => slot.assignedCatId === null)).toBe(true)
    expect(cat(simulation)).toMatchObject({ slotId: 'rest-1-slot-1', vigor: 100 })

    expect(simulation.hireCat()).toMatchObject({ ok: true, value: { id: 'cat-2', vigor: 0, slotId: 'rest-1-slot-2' } })
  })

  it('adds a generation number when cat names repeat', () => {
    const simulation = new Simulation()
    for (let index = 0; index < 5; index += 1) simulation.hireCat()

    expect(simulation.snapshot().cats.map((candidate) => candidate.name)).toEqual([
      'Мира', 'Нокс', 'Север', 'Иней', 'Пиксель', 'Мира 2',
    ])
  })

  it('allows more cats than seats and queues them without recovery', () => {
    const simulation = new Simulation()
    simulation.hireCat()
    simulation.hireCat()
    simulation.hireCat()
    expect(simulation.snapshot().cats).toHaveLength(4)
    expect(cat(simulation, 'cat-4')).toMatchObject({ nodeId: 'rest-1', slotId: null, vigor: 0 })

    simulation.tick(5)
    expect(cat(simulation, 'cat-4').vigor).toBe(0)
    expect(simulation.snapshot().cats.filter((candidate) => candidate.slotId)).toHaveLength(3)
  })

  it('allows assigning a resting cat before full recovery, but sends it only at full vigor', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.hireCat()

    expect(simulation.assignCat('cat-2', research.id, research.slots[0].id)).toMatchObject({ ok: true })
    expect(node(simulation, 'research').slots[0]).toMatchObject({ assignedCatId: 'cat-2', reservedByCatId: null })
    expect(cat(simulation, 'cat-2')).toMatchObject({ nodeId: 'rest-1', status: 'idle', vigor: 0 })

    simulation.tick(4.9)
    expect(cat(simulation, 'cat-2')).toMatchObject({ status: 'idle', vigor: 98 })
    simulation.tick(0.1)
    expect(cat(simulation, 'cat-2')).toMatchObject({ status: 'travelling', vigor: 100 })
  })

  it('returns an exhausted worker to the first available common seat', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.assignCat('cat-1', research.id, research.slots[0].id)
    simulation.tick(1)
    simulation.tick(10)

    expect(cat(simulation)).toMatchObject({ vigor: 0, status: 'travelling' })
    expect(cat(simulation).travel).toMatchObject({ targetNodeId: 'rest-1', targetSlotId: 'rest-1-slot-1' })
  })

  it('keeps an exhausted worker at work when every suitable rest seat is occupied, then retries', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.assignCat('cat-1', research.id, research.slots[0].id)
    simulation.hireCat()
    simulation.hireCat()
    simulation.hireCat()
    simulation.tick(5)
    simulation.tick(1)
    simulation.tick(10)

    expect(cat(simulation)).toMatchObject({ nodeId: research.id, status: 'idle', vigor: 0 })
    expect(simulation.assignCat('cat-2', research.id, research.slots[1].id).ok).toBe(true)
    simulation.tick(0.1)
    expect(cat(simulation)).toMatchObject({ status: 'travelling', vigor: 0 })
    expect(cat(simulation).travel?.targetNodeId).toBe('rest-1')
  })

  it('seats waiting cats in FIFO order when a common seat opens', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.hireCat()
    simulation.hireCat()
    simulation.hireCat()
    simulation.tick(5)

    expect(cat(simulation, 'cat-4').slotId).toBeNull()
    expect(simulation.assignCat('cat-2', research.id, research.slots[0].id).ok).toBe(true)
    expect(cat(simulation, 'cat-4').slotId).toBe('rest-1-slot-2')
  })

  it('keeps persistent work assignments and automatically returns a recovered seated cat', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.assignCat('cat-1', research.id, research.slots[0].id)
    simulation.tick(1)
    simulation.tick(10)
    simulation.tick(1)
    simulation.tick(5)

    expect(cat(simulation)).toMatchObject({ status: 'travelling', vigor: 100 })
    expect(cat(simulation).travel?.targetNodeId).toBe(research.id)
    expect(node(simulation, 'research').slots[0]).toMatchObject({ assignedCatId: 'cat-1', reservedByCatId: 'cat-1' })
  })

  it('releases an assigned working cat immediately and sends it directly to rest', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.assignCat('cat-1', research.id, research.slots[0].id)
    simulation.tick(1)

    expect(simulation.clearWorkAssignment(research.id, research.slots[0].id)).toMatchObject({ ok: false })
    expect(simulation.releaseCat('cat-1')).toMatchObject({ ok: true })
    expect(node(simulation, 'research').slots[0]).toMatchObject({ catId: null, assignedCatId: null })
    expect(cat(simulation)).toMatchObject({ nodeId: research.id, slotId: null, status: 'travelling', travel: { targetNodeId: 'rest-1' } })
  })

  it('moves a working cat directly to a slot in another module', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing transfer network')
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'north', 'road')
    simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'east', 'road')
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.tick(2)

    expect(simulation.assignCat('cat-1', server.value.id, server.value.slots[0].id)).toMatchObject({ ok: true })
    expect(research.value.id).not.toBe(server.value.id)
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === research.value.id)?.slots[0]).toMatchObject({ catId: null, assignedCatId: null })
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === server.value.id)?.slots[0]).toMatchObject({ catId: null, assignedCatId: 'cat-1', reservedByCatId: 'cat-1' })
    expect(cat(simulation)).toMatchObject({ nodeId: research.value.id, slotId: null, status: 'travelling', travel: { targetNodeId: server.value.id } })

    simulation.tick(2)
    expect(cat(simulation)).toMatchObject({ nodeId: server.value.id, slotId: server.value.slots[0].id, status: 'idle' })
  })

  it('moves a working cat instantly between slots in the same module', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.assignCat('cat-1', research.id, research.slots[0].id)
    simulation.tick(1)

    expect(simulation.assignCat('cat-1', research.id, research.slots[1].id)).toMatchObject({ ok: true })
    expect(node(simulation, 'research').slots[0]).toMatchObject({ catId: null, assignedCatId: null })
    expect(node(simulation, 'research').slots[1]).toMatchObject({ catId: 'cat-1', assignedCatId: 'cat-1', reservedByCatId: null })
    expect(cat(simulation)).toMatchObject({ nodeId: research.id, slotId: research.slots[1].id, status: 'idle' })
  })

  it('redirects a travelling cat from the start of its current road leg', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing redirect network')
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 2, 'north', 'road')
    simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'east', 'road')
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.tick(1.5)

    expect(cat(simulation).travel).toMatchObject({ kind: 'road', leg: { fromNodeId: hub.value.id, toNodeId: research.value.id }, legProgress: 0.25 })
    expect(simulation.assignCat('cat-1', server.value.id, server.value.slots[0].id)).toMatchObject({ ok: true })
    expect(research.value.id).not.toBe(server.value.id)
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === research.value.id)?.slots[0]).toMatchObject({ assignedCatId: null, reservedByCatId: null })
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === server.value.id)?.slots[0]).toMatchObject({ assignedCatId: 'cat-1', reservedByCatId: 'cat-1' })
    expect(cat(simulation)).toMatchObject({ nodeId: hub.value.id, status: 'travelling', travel: { targetNodeId: server.value.id, leg: { fromNodeId: hub.value.id } } })
  })

  it('keeps an active destination intact when a redirect target is unavailable', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing atomic redirect network')
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'north', 'road')
    simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'east', 'road')
    simulation.hireCat()
    simulation.tick(5)
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.assignCat('cat-2', server.value.id, server.value.slots[0].id)
    const before = cat(simulation, 'cat-1')

    expect(simulation.assignCat('cat-1', server.value.id, server.value.slots[0].id)).toMatchObject({ ok: false, reason: expect.stringContaining('занят') })
    expect(cat(simulation, 'cat-1')).toEqual(before)
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === research.value.id)?.slots[0]).toMatchObject({ assignedCatId: 'cat-1', reservedByCatId: 'cat-1' })
  })

  it('changes future work without interrupting a return-to-rest journey', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing future-work network')
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'north', 'road')
    simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'east', 'road')
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.tick(2)
    simulation.releaseCat('cat-1')
    const restTarget = cat(simulation).travel

    expect(restTarget).toMatchObject({ targetNodeId: 'rest-1', targetSlotId: 'rest-1-slot-1' })
    expect(simulation.assignCat('cat-1', server.value.id, server.value.slots[0].id)).toMatchObject({ ok: true })
    expect(cat(simulation).travel).toEqual(restTarget)
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === server.value.id)?.slots[0]).toMatchObject({ assignedCatId: 'cat-1', reservedByCatId: null })
    expect(node(simulation, 'rest').slots[0].reservedByCatId).toBe('cat-1')
  })

  it('cancels a work destination at the current road-leg start and sends the cat to rest', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const hub = simulation.createNode('hub')
    if (!research.ok || !hub.ok) throw new Error('Missing cancellation network')
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 2, 'north', 'road')
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.tick(1.5)

    expect(simulation.cancelCatWorkDestination('cat-1')).toMatchObject({ ok: true })
    expect(node(simulation, 'research').slots[0]).toMatchObject({ assignedCatId: null, reservedByCatId: null })
    expect(cat(simulation)).toMatchObject({ nodeId: hub.value.id, status: 'travelling', travel: { targetNodeId: 'rest-1', leg: { fromNodeId: hub.value.id, toNodeId: 'rest-1' } } })
  })

  it('keeps a cancelled traveller visible when every rest seat is occupied', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)
    simulation.connectWorkerNodes('rest-1', research.value.id, 2)
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.hireCat()
    simulation.hireCat()
    simulation.hireCat()

    expect(node(simulation, 'rest').slots.every((slot) => slot.catId)).toBe(true)
    expect(simulation.cancelCatWorkDestination('cat-1')).toMatchObject({ ok: true })
    expect(cat(simulation)).toMatchObject({ nodeId: 'rest-1', slotId: null, status: 'stranded', travel: null, stranded: { targetNodeId: 'rest-1', targetSlotId: null } })
    expect(node(simulation, 'research').slots[0]).toMatchObject({ assignedCatId: null, reservedByCatId: null })
  })

  it('cancels a stranded work destination from the cat current node', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    const server = simulation.createNode('server')
    if (!server.ok) throw new Error(server.reason)
    simulation.assignCat('cat-1', research.id, research.slots[0].id)
    simulation.tick(1)
    simulation.assignCat('cat-1', server.value.id, server.value.slots[0].id)

    expect(cat(simulation)).toMatchObject({ nodeId: research.id, status: 'stranded', stranded: { targetNodeId: server.value.id } })
    simulation.disconnectWorkerLink(simulation.snapshot().workerLinks[0].id)
    expect(simulation.cancelCatWorkDestination('cat-1')).toMatchObject({ ok: true })
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === server.value.id)?.slots[0]).toMatchObject({ assignedCatId: null, reservedByCatId: null })
    expect(cat(simulation)).toMatchObject({ nodeId: research.id, status: 'stranded', travel: null, stranded: { targetNodeId: 'rest-1' } })
  })

  it('keeps a worker in its source slot when the transfer target is occupied', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing occupied-target setup')
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'north', 'road')
    simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'east', 'road')
    simulation.hireCat()
    simulation.tick(5)
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.assignCat('cat-2', server.value.id, server.value.slots[0].id)
    simulation.tick(2)

    expect(simulation.assignCat('cat-1', server.value.id, server.value.slots[0].id)).toMatchObject({ ok: false, reason: expect.stringContaining('занят') })
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === research.value.id)?.slots[0]).toMatchObject({ catId: 'cat-1', assignedCatId: 'cat-1' })
    expect(cat(simulation)).toMatchObject({ nodeId: research.value.id, slotId: research.value.slots[0].id, status: 'idle' })
  })

  it('strands a transferred worker at its source until a route to the new job appears', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    const server = simulation.createNode('server')
    if (!server.ok) throw new Error(server.reason)
    simulation.assignCat('cat-1', research.id, research.slots[0].id)
    simulation.tick(1)

    expect(simulation.assignCat('cat-1', server.value.id, server.value.slots[0].id)).toMatchObject({ ok: true })
    expect(node(simulation, 'research').slots[0]).toMatchObject({ catId: null, assignedCatId: null })
    expect(cat(simulation)).toMatchObject({ nodeId: research.id, slotId: null, status: 'stranded', stranded: { targetNodeId: server.value.id, targetSlotId: server.value.slots[0].id } })

    const oldRoad = simulation.snapshot().workerLinks[0]
    simulation.disconnectWorkerLink(oldRoad.id)
    simulation.connectWorkerNodes(research.id, server.value.id, 1)
    expect(cat(simulation)).toMatchObject({ status: 'travelling', travel: { targetNodeId: server.value.id } })
  })

  it('keeps a released worker stranded until a rest seat becomes available', () => {
    let simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.hireCat()
    simulation.hireCat()
    simulation.tick(5)
    simulation.assignCat('cat-1', research.id, research.slots[0].id)
    simulation.tick(1)
    simulation.hireCat()

    expect(node(simulation, 'rest').slots.every((slot) => slot.catId)).toBe(true)
    expect(simulation.releaseCat('cat-1')).toMatchObject({ ok: true })
    expect(cat(simulation)).toMatchObject({ nodeId: research.id, slotId: null, status: 'stranded', stranded: { targetNodeId: 'rest-1', targetSlotId: null } })
    expect(node(simulation, 'research').slots[0]).toMatchObject({ catId: null, assignedCatId: null })

    const restored = Simulation.fromSave(simulation.exportSave())
    if (!restored.ok) throw new Error(restored.reason)
    simulation = restored.value
    expect(cat(simulation)).toMatchObject({ status: 'stranded', stranded: { targetNodeId: 'rest-1', targetSlotId: null } })

    expect(simulation.assignCat('cat-2', research.id, research.slots[1].id)).toMatchObject({ ok: true })
    expect(cat(simulation)).toMatchObject({ status: 'travelling', travel: { targetNodeId: 'rest-1', targetSlotId: 'rest-1-slot-2' } })
  })

  it('releases a worker from its slot even when the route to rest is unavailable', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.assignCat('cat-1', research.id, research.slots[0].id)
    simulation.tick(1)
    const road = simulation.snapshot().workerLinks[0]
    simulation.disconnectWorkerLink(road.id)

    expect(simulation.releaseCat('cat-1')).toMatchObject({ ok: true })
    expect(node(simulation, 'research').slots[0]).toMatchObject({ catId: null, assignedCatId: null })
    expect(node(simulation, 'rest').slots[0]).toMatchObject({ reservedByCatId: 'cat-1' })
    expect(cat(simulation)).toMatchObject({ nodeId: research.id, slotId: null, status: 'stranded', stranded: { targetNodeId: 'rest-1', targetSlotId: 'rest-1-slot-1' } })

    simulation.connectWorkerNodes(research.id, 'rest-1', 1)
    expect(cat(simulation)).toMatchObject({ status: 'travelling', travel: { targetNodeId: 'rest-1' } })
  })

  it('keeps a full cat assigned without a route and starts the journey when a route appears', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)

    expect(simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)).toMatchObject({ ok: true })
    expect(node(simulation, 'research').slots[0]).toMatchObject({ assignedCatId: 'cat-1', reservedByCatId: null })
    expect(cat(simulation)).toMatchObject({ nodeId: 'rest-1', status: 'idle', vigor: 100 })

    simulation.tick(1)
    expect(cat(simulation)).toMatchObject({ nodeId: 'rest-1', status: 'idle', vigor: 100 })

    simulation.connectWorkerNodes('rest-1', research.value.id, 1)
    simulation.tick(0)
    expect(cat(simulation)).toMatchObject({ status: 'travelling' })
    simulation.tick(0.5)
    expect(node(simulation, 'research').productionRate).toBe(0)
    simulation.tick(0.5)
    expect(node(simulation, 'research').slots[0].catId).toBe('cat-1')
    simulation.tick(1)
    expect(node(simulation, 'research').dataBuffer).toBeCloseTo(1)
  })

  it('scales research output with the number of occupied work slots', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.hireCat()
    simulation.tick(5)

    expect(simulation.assignCat('cat-1', research.id, research.slots[0].id).ok).toBe(true)
    expect(simulation.assignCat('cat-2', research.id, research.slots[1].id).ok).toBe(true)
    simulation.tick(1)
    simulation.tick(1)

    expect(node(simulation, 'research').productionRate).toBe(2)
    expect(node(simulation, 'research').dataBuffer).toBeCloseTo(2)
  })

  it('recalculates the globally fastest remaining route at each hub', () => {
    const simulation = new Simulation()
    const server = simulation.createNode('server')
    const first = simulation.createNode('hub')
    const slow = simulation.createNode('hub')
    const fast = simulation.createNode('hub')
    const destination = simulation.createNode('hub')
    if (!server.ok || !first.ok || !slow.ok || !fast.ok || !destination.ok) throw new Error('Missing network node')
    simulation.connectWorkerNodes('rest-1', first.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(first.value.id, slow.value.id, 1, 'north', 'west')
    simulation.connectWorkerNodes(first.value.id, fast.value.id, 2, 'east', 'west')
    simulation.connectWorkerNodes(slow.value.id, destination.value.id, 20, 'east', 'west')
    simulation.connectWorkerNodes(fast.value.id, destination.value.id, 1, 'east', 'south')
    simulation.connectWorkerNodes(destination.value.id, server.value.id, 1, 'east', 'road')

    expect(simulation.assignCat('cat-1', server.value.id, server.value.slots[0].id).ok).toBe(true)
    expect(cat(simulation).travel).toMatchObject({ kind: 'road', leg: { toNodeId: first.value.id } })
    simulation.tick(1)
    expect(cat(simulation).travel).toMatchObject({ kind: 'road', leg: { toNodeId: fast.value.id } })
    simulation.tick(4)
    expect(node(simulation, 'server').slots[0].catId).toBe('cat-1')
  })

  it('updates data throughput only for arrived workers and slows the server without its operator', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing work node')
    simulation.connect(research.value.id, server.value.id)
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'north', 'road')
    simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'east', 'road')
    simulation.hireCat()
    simulation.tick(5)

    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.assignCat('cat-2', server.value.id, server.value.slots[0].id)
    simulation.tick(1)
    simulation.tick(1)
    simulation.tick(1)
    simulation.tick(1)
    expect(node(simulation, 'server').inputRate).toBeCloseTo(1)
    expect(node(simulation, 'server').dataStored).toBeCloseTo(2)
    simulation.releaseCat('cat-2')
    simulation.tick(1)
    simulation.tick(2)
    expect(node(simulation, 'server').inputRate).toBeCloseTo(0.5)
  })

  it('returns a travelling cat to its current leg source when removing its link', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)
    const link = simulation.connectWorkerNodes('rest-1', research.value.id, 4)
    if (!link.ok) throw new Error(link.reason)

    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    expect(simulation.updateWorkerLinkTravelTime(link.value.id, 0.5).ok).toBe(true)
    simulation.tick(0.25)
    expect(simulation.disconnectWorkerLink(link.value.id).ok).toBe(true)
    expect(cat(simulation)).toMatchObject({ nodeId: 'rest-1', status: 'stranded', travel: null, stranded: { targetNodeId: research.value.id } })
    expect(node(simulation, 'research').slots[0].reservedByCatId).toBe('cat-1')
  })

  it('reroutes a returned cat immediately after removing its current link', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const first = simulation.createNode('hub')
    const detour = simulation.createNode('hub')
    const last = simulation.createNode('hub')
    if (!research.ok || !first.ok || !detour.ok || !last.ok) throw new Error('Missing node')

    simulation.connectWorkerNodes('rest-1', first.value.id, 1, 'road', 'west')
    const direct = simulation.connectWorkerNodes(first.value.id, last.value.id, 2, 'east', 'west')
    simulation.connectWorkerNodes(first.value.id, detour.value.id, 1, 'north', 'west')
    simulation.connectWorkerNodes(detour.value.id, last.value.id, 1, 'east', 'north')
    simulation.connectWorkerNodes(last.value.id, research.value.id, 1, 'east', 'road')
    if (!direct.ok) throw new Error(direct.reason)

    expect(simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id).ok).toBe(true)
    simulation.tick(1.5)
    expect(cat(simulation).travel).toMatchObject({ kind: 'road', leg: { linkId: direct.value.id } })

    expect(simulation.disconnectWorkerLink(direct.value.id).ok).toBe(true)
    expect(cat(simulation)).toMatchObject({ nodeId: first.value.id, status: 'travelling', stranded: null })
    expect(cat(simulation).travel).toMatchObject({ kind: 'road', leg: { toNodeId: detour.value.id } })
  })

  it('limits regular modules to one road and each hub side to one road', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing node')

    expect(simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'north').ok).toBe(true)
    expect(simulation.connectWorkerNodes('rest-1', research.value.id, 1, 'road', 'road')).toMatchObject({ ok: false })
    expect(simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'north', 'road')).toMatchObject({ ok: false })
    expect(simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'east', 'road').ok).toBe(true)
    expect(simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'south', 'road').ok).toBe(true)
  })

  it('strands cats at a selected surviving hub and resumes them after reconnection', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const first = simulation.createNode('hub')
    const rescue = simulation.createNode('hub')
    if (!research.ok || !first.ok || !rescue.ok) throw new Error('Missing node')
    simulation.connectWorkerNodes('rest-1', first.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(first.value.id, research.value.id, 2, 'east', 'road')
    expect(simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id).ok).toBe(true)

    expect(simulation.deleteRoadHub(first.value.id, { 'cat-1': rescue.value.id }).ok).toBe(true)
    expect(cat(simulation)).toMatchObject({ nodeId: rescue.value.id, status: 'stranded', stranded: { targetNodeId: research.value.id } })
    expect(node(simulation, 'research').slots[0].reservedByCatId).toBe('cat-1')
    simulation.connectWorkerNodes(rescue.value.id, research.value.id, 1, 'west', 'road')
    expect(cat(simulation)).toMatchObject({ status: 'travelling', stranded: null })
    simulation.tick(1)
    expect(node(simulation, 'research').slots[0].catId).toBe('cat-1')
  })

  it('keeps blocked nodes out of roads, work, and route calculation', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error('Missing research')

    expect(simulation.setNodeBlocked(research.value.id, true).ok).toBe(true)
    expect(simulation.connectWorkerNodes('rest-1', research.value.id, 1)).toMatchObject({ ok: false, reason: expect.stringContaining('Перекрытый') })
    expect(simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)).toMatchObject({ ok: false, reason: expect.stringContaining('Перекрытый') })
    expect(simulation.snapshot().nodes.find((node) => node.id === research.value.id)).toMatchObject({ blocked: true })
  })
})

describe('Simulation flight era', () => {
  function unlockFlight(simulation: Simulation) {
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    if (!research.ok || !server.ok) throw new Error('Missing flight research setup')
    const road = simulation.connectWorkerNodes('rest-1', research.value.id, 1)
    if (!road.ok) throw new Error(road.reason)
    simulation.connect(research.value.id, server.value.id)
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    for (let second = 0; second < 240 && !simulation.snapshot().flightUnlocked; second += 1) simulation.tick(1)
    if (!simulation.snapshot().flightUnlocked) throw new Error('Flight did not unlock')
    return { research: research.value, server: server.value, road: road.value }
  }

  it('unlocks at 50 data units and sends cats directly at twice road speed', () => {
    const simulation = new Simulation()
    const { road } = unlockFlight(simulation)
    expect(simulation.snapshot().scienceProgress).toBe(50)
    expect(simulation.snapshot().flightUnlocked).toBe(true)

    const destination = simulation.createNode('research')
    const other = simulation.createNode('server')
    if (!destination.ok || !other.ok) throw new Error('Missing flight destination')
    simulation.setNodePosition('rest-1', { x: 0, y: 0 })
    simulation.setNodePosition(destination.value.id, { x: 500, y: 0 })
    simulation.hireCat()
    simulation.tick(5)

    expect(simulation.assignCat('cat-2', destination.value.id, destination.value.slots[0].id)).toMatchObject({ ok: true })
    expect(cat(simulation, 'cat-2').travel).toMatchObject({ kind: 'flight', fromSlotId: 'rest-1-slot-2', flightDurationSeconds: 1, flightProgress: 0 })
    expect(simulation.connectWorkerNodes(destination.value.id, other.value.id, 1)).toMatchObject({ ok: true })
    expect(simulation.createNode('hub')).toMatchObject({ ok: true })

    expect(simulation.disconnectWorkerLink(road.id)).toMatchObject({ ok: true })
    simulation.tick(0.5)
    expect(cat(simulation, 'cat-2').travel).toMatchObject({ kind: 'flight', flightProgress: 0.5 })
    simulation.tick(0.5)
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === destination.value.id)?.slots.some((slot) => slot.catId === 'cat-2')).toBe(true)
  })

  it('cancels a flight destination at its origin and seats the cat there immediately', () => {
    const simulation = new Simulation()
    unlockFlight(simulation)
    const destination = simulation.createNode('research')
    if (!destination.ok) throw new Error(destination.reason)
    simulation.setNodePosition('rest-1', { x: 0, y: 0 })
    simulation.setNodePosition(destination.value.id, { x: 500, y: 0 })
    simulation.hireCat()
    simulation.tick(5)
    simulation.assignCat('cat-2', destination.value.id, destination.value.slots[0].id)
    simulation.tick(0.5)

    expect(cat(simulation, 'cat-2').travel).toMatchObject({ kind: 'flight', fromNodeId: 'rest-1', flightProgress: 0.5 })
    expect(simulation.cancelCatWorkDestination('cat-2')).toMatchObject({ ok: true })
    expect(cat(simulation, 'cat-2')).toMatchObject({ nodeId: 'rest-1', slotId: expect.any(String), status: 'idle', travel: null, stranded: null })
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === destination.value.id)?.slots[0]).toMatchObject({ assignedCatId: null, reservedByCatId: null })
  })

  it('resumes a stranded cat when research progress reaches the flight threshold', () => {
    const simulation = fundedSimulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing stranded setup')
    simulation.connectWorkerNodes('rest-1', hub.value.id, 1, 'road', 'west')
    simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'north', 'road')
    const serverRoad = simulation.connectWorkerNodes(hub.value.id, server.value.id, 1, 'east', 'road')
    if (!serverRoad.ok) throw new Error(serverRoad.reason)
    simulation.setNodePosition('rest-1', { x: 0, y: 0 })
    simulation.setNodePosition(research.value.id, { x: 500, y: 0 })
    simulation.setNodePosition(server.value.id, { x: 800, y: 0 })
    simulation.hireCat()
    simulation.tick(5)
    simulation.assignCat('cat-1', server.value.id, server.value.slots[0].id)
    simulation.assignCat('cat-2', research.value.id, research.value.slots[0].id)
    for (let second = 0; second < 240 && simulation.snapshot().scienceProgress < 49; second += 1) simulation.tick(1)
    expect(simulation.snapshot().flightUnlocked).toBe(false)
    expect(simulation.releaseCat('cat-1')).toMatchObject({ ok: true })
    expect(simulation.disconnectWorkerLink(serverRoad.value.id)).toMatchObject({ ok: true })
    expect(cat(simulation)).toMatchObject({ status: 'stranded', stranded: { targetNodeId: 'rest-1' } })

    simulation.tick(1)
    expect(simulation.snapshot().flightUnlocked).toBe(true)
    expect(cat(simulation).travel).toMatchObject({ kind: 'flight', targetNodeId: 'rest-1', flightProgress: 0 })
  })

  it('finishes an active road leg before switching to direct flight at a hub', () => {
    const simulation = new Simulation()
    const research = simulation.createNode('research')
    const server = simulation.createNode('server')
    const hub = simulation.createNode('hub')
    if (!research.ok || !server.ok || !hub.ok) throw new Error('Missing transition setup')
    const firstRoad = simulation.connectWorkerNodes('rest-1', hub.value.id, 20, 'road', 'west')
    const secondRoad = simulation.connectWorkerNodes(hub.value.id, research.value.id, 1, 'east', 'road')
    if (!firstRoad.ok || !secondRoad.ok) throw new Error('Missing transition road')
    simulation.setNodePosition('rest-1', { x: 0, y: 0 })
    simulation.setNodePosition(hub.value.id, { x: 1000, y: 0 })
    simulation.setNodePosition(research.value.id, { x: 2000, y: 0 })
    simulation.connect(research.value.id, server.value.id)
    simulation.assignCat('cat-1', research.value.id, research.value.slots[0].id)
    simulation.hireCat()
    simulation.tick(5)
    for (let second = 0; second < 320 && simulation.snapshot().scienceProgress < 46; second += 1) simulation.tick(1)

    expect(simulation.assignCat('cat-2', research.value.id, research.value.slots[1].id)).toMatchObject({ ok: true })
    for (let second = 0; second < 20 && !simulation.snapshot().flightUnlocked; second += 1) simulation.tick(1)
    const travelling = cat(simulation, 'cat-2').travel
    expect(travelling).toMatchObject({ kind: 'road', leg: { toNodeId: hub.value.id } })
    if (!travelling || travelling.kind !== 'road') throw new Error('Cat did not remain on the road')

    simulation.tick(firstRoad.value.travelSeconds * (1 - travelling.legProgress))
    expect(cat(simulation, 'cat-2').travel).toMatchObject({ kind: 'flight', fromNodeId: hub.value.id, targetNodeId: research.value.id })
    expect(simulation.disconnectWorkerLink(firstRoad.value.id)).toMatchObject({ ok: true })
    expect(cat(simulation, 'cat-2').travel).toMatchObject({ kind: 'flight' })
  })
})

describe('Simulation cozy economy and data network', () => {
  function objectiveCandidate(options: {
    scienceProgress?: number
    researchNodes?: number
    staffedResearchSlots?: number
    terminalNodes?: number
    storedData?: number
    extraCats?: number
    profitableSeconds?: number
    peakNetIncomePerMinute?: number
  } = {}) {
    const {
      scienceProgress = GAME_BALANCE.science.flightUnlockProgress,
      researchNodes = GAME_BALANCE.objective.requiredResearchNodes,
      staffedResearchSlots = researchNodes * GAME_BALANCE.nodes.research.slots,
      terminalNodes = 2,
      storedData = 1000,
      extraCats = 0,
      profitableSeconds = 0,
      peakNetIncomePerMinute = GAME_BALANCE.objective.requiredPeakNetIncomePerMinute,
    } = options
    const simulation = fundedSimulation()
    const researchIds: string[] = []
    for (let index = 0; index < researchNodes; index += 1) {
      const research = simulation.createNode('research')
      if (!research.ok) throw new Error(research.reason)
      researchIds.push(research.value.id)
    }
    const assignmentCount = Math.min(staffedResearchSlots, researchNodes * GAME_BALANCE.nodes.research.slots)
    for (let index = 1; index < assignmentCount + extraCats; index += 1) simulation.hireCat()
    const server = simulation.createNode('server')
    if (!server.ok) throw new Error('Missing objective server')
    const terminalIds: string[] = []
    for (let index = 0; index < terminalNodes; index += 1) {
      const terminal = simulation.createNode('terminal')
      if (!terminal.ok) throw new Error(terminal.reason)
      simulation.connect(server.value.id, terminal.value.id)
      terminalIds.push(terminal.value.id)
    }
    const save = simulation.exportSave()
    save.simulation.flightUnlocked = scienceProgress >= GAME_BALANCE.science.flightUnlockProgress
    save.simulation.scienceProgress = scienceProgress
    save.simulation.nodes.find((candidate) => candidate.id === server.value.id)!.dataStored = storedData
    save.simulation.goal.profitableSeconds = profitableSeconds
    save.simulation.goal.peakNetIncomePerMinute = peakNetIncomePerMinute
    const researchSlots = save.simulation.nodes.filter((candidate) => candidate.type === 'research').flatMap((candidate) => candidate.slots)
    for (let index = 0; index < assignmentCount; index += 1) researchSlots[index].assignedCatId = save.simulation.cats[index].id
    const restored = Simulation.fromSave(save)
    if (!restored.ok) throw new Error(restored.reason)
    return { simulation: restored.value, researchIds, terminalIds }
  }

  it('defines balance for every node type and charges the shared configured prices', () => {
    expect(Object.keys(GAME_BALANCE.nodes).sort()).toEqual(['hub', 'research', 'rest', 'server', 'terminal'])
    const simulation = new Simulation()
    const before = simulation.snapshot().economy.credits
    const terminal = simulation.createNode('terminal')
    expect(terminal).toMatchObject({ ok: true, value: { type: 'terminal', slots: [{ id: expect.any(String) }] } })
    expect(simulation.snapshot().economy.credits).toBe(before - GAME_BALANCE.nodes.terminal.cost)
    if (!terminal.ok) throw new Error(terminal.reason)
    simulation.deleteNode(terminal.value.id)
    expect(simulation.snapshot().economy.credits).toBe(before - GAME_BALANCE.nodes.terminal.cost * (1 - GAME_BALANCE.economy.demolitionRefundRatio))
  })

  it('exposes recurring upkeep by module type and crew', () => {
    const simulation = new Simulation()
    simulation.createNode('research')
    simulation.createNode('server')
    simulation.createNode('terminal')
    simulation.createNode('hub')
    simulation.createNode('rest')
    simulation.hireCat()

    const economy = simulation.snapshot().economy
    expect(economy.upkeepBreakdown).toEqual({
      rest: GAME_BALANCE.nodes.rest.upkeepPerMinute * 2,
      research: GAME_BALANCE.nodes.research.upkeepPerMinute,
      server: GAME_BALANCE.nodes.server.upkeepPerMinute,
      hub: GAME_BALANCE.nodes.hub.upkeepPerMinute,
      terminal: GAME_BALANCE.nodes.terminal.upkeepPerMinute,
      cats: GAME_BALANCE.economy.catUpkeepPerMinute * 2,
    })
    expect(economy.upkeepPerMinute).toBe(Object.values(economy.upkeepBreakdown).reduce((total, value) => total + value, 0))
  })

  it('produces irreversible science progress and sellable data without a server', () => {
    const simulation = new Simulation()
    const research = createResearch(simulation)
    simulation.assignCat('cat-1', research.id, research.slots[0].id)
    simulation.tick(1)
    simulation.tick(1)

    expect(simulation.snapshot().scienceProgress).toBeCloseTo(GAME_BALANCE.science.progressPerWorkSecond)
    expect(node(simulation, 'research').dataBuffer).toBeCloseTo(GAME_BALANCE.science.dataPerWorkSecond)
    expect(simulation.snapshot().connections).toHaveLength(0)
  })

  it('enforces the directed data compatibility matrix, server fan-out, bounded terminal inputs, and cycle rejection', () => {
    const simulation = fundedSimulation()
    const research = simulation.createNode('research')
    const first = simulation.createNode('server')
    const second = simulation.createNode('server')
    const third = simulation.createNode('server')
    const firstTerminal = simulation.createNode('terminal')
    const secondTerminal = simulation.createNode('terminal')
    if (!research.ok || !first.ok || !second.ok || !third.ok || !firstTerminal.ok || !secondTerminal.ok) throw new Error('Missing data nodes')

    expect(simulation.connect(research.value.id, firstTerminal.value.id)).toMatchObject({ ok: false, reason: expect.stringContaining('Несовместимые') })
    expect(simulation.connect(first.value.id, first.value.id)).toMatchObject({ ok: false, reason: expect.stringContaining('самим собой') })
    expect(simulation.connect(research.value.id, first.value.id).ok).toBe(true)
    expect(simulation.connect(first.value.id, second.value.id).ok).toBe(true)
    expect(simulation.connect(second.value.id, first.value.id)).toMatchObject({ ok: false, reason: expect.stringContaining('цикл') })
    expect(simulation.connect(second.value.id, firstTerminal.value.id).ok).toBe(true)
    expect(simulation.connect(second.value.id, secondTerminal.value.id).ok).toBe(true)
    expect(simulation.connect(second.value.id, third.value.id).ok).toBe(true)
    expect(simulation.connect(second.value.id, firstTerminal.value.id)).toMatchObject({ ok: false, reason: expect.stringContaining('уже существует') })
    expect(simulation.connect(third.value.id, firstTerminal.value.id)).toMatchObject({ ok: false, reason: expect.stringContaining('Вход') })
    expect(simulation.connect(third.value.id, second.value.id)).toMatchObject({ ok: false, reason: expect.stringContaining('цикл') })
  })

  it('lets multiple terminals pull independently from one server and round-trips the fan-out save', () => {
    let simulation = fundedSimulation()
    const server = simulation.createNode('server')
    const relay = simulation.createNode('server')
    const firstTerminal = simulation.createNode('terminal')
    const secondTerminal = simulation.createNode('terminal')
    if (!server.ok || !relay.ok || !firstTerminal.ok || !secondTerminal.ok) throw new Error('Missing fan-out nodes')

    expect(simulation.connect(server.value.id, relay.value.id).ok).toBe(true)
    expect(simulation.connect(server.value.id, firstTerminal.value.id).ok).toBe(true)
    expect(simulation.connect(server.value.id, secondTerminal.value.id).ok).toBe(true)

    const save = simulation.exportSave()
    save.simulation.nodes.find((candidate) => candidate.id === server.value.id)!.dataStored = 2
    const restored = Simulation.fromSave(save)
    if (!restored.ok) throw new Error(restored.reason)
    expect(restored.value.exportSave()).toEqual(save)
    simulation = restored.value

    simulation.tick(1)
    const snapshot = simulation.snapshot()
    expect(snapshot.nodes.find((candidate) => candidate.id === relay.value.id)?.dataStored).toBeCloseTo(0.5)
    expect(snapshot.nodes.find((candidate) => candidate.id === firstTerminal.value.id)?.dataSold).toBeCloseTo(0.25)
    expect(snapshot.nodes.find((candidate) => candidate.id === secondTerminal.value.id)?.dataSold).toBeCloseTo(0.25)
    expect(snapshot.nodes.find((candidate) => candidate.id === server.value.id)?.outputRate).toBeCloseTo(1)
    expect(snapshot.nodes.find((candidate) => candidate.id === server.value.id)?.dataStored).toBeCloseTo(1)
  })

  it('shares server input fairly, conserves relayed data, and sells terminal inventory', () => {
    let simulation = fundedSimulation()
    const firstResearch = simulation.createNode('research')
    const secondResearch = simulation.createNode('research')
    const server = simulation.createNode('server')
    const terminal = simulation.createNode('terminal')
    if (!firstResearch.ok || !secondResearch.ok || !server.ok || !terminal.ok) throw new Error('Missing trade nodes')
    simulation.connect(firstResearch.value.id, server.value.id)
    simulation.connect(secondResearch.value.id, server.value.id)
    simulation.connect(server.value.id, terminal.value.id)
    const save = simulation.exportSave()
    save.simulation.nodes.find((candidate) => candidate.id === firstResearch.value.id)!.dataBuffer = 10
    save.simulation.nodes.find((candidate) => candidate.id === secondResearch.value.id)!.dataBuffer = 10
    const restored = Simulation.fromSave(save)
    if (!restored.ok) throw new Error(restored.reason)
    simulation = restored.value

    simulation.tick(1)
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === firstResearch.value.id)?.dataBuffer).toBeCloseTo(9.75)
    expect(simulation.snapshot().nodes.find((candidate) => candidate.id === secondResearch.value.id)?.dataBuffer).toBeCloseTo(9.75)
    expect(node(simulation, 'server').dataStored).toBeCloseTo(0.25)
    expect(node(simulation, 'terminal').dataSold).toBeCloseTo(0.25)
    expect(simulation.snapshot().economy.totalEarned).toBeCloseTo(0.25 * GAME_BALANCE.economy.dataSalePrice)
    const conserved = simulation.snapshot().nodes.reduce((total, candidate) => total + candidate.dataBuffer + candidate.dataStored + candidate.dataSold, 0)
    expect(conserved).toBeCloseTo(20)
  })

  it('dismisses a travelling non-starter cat safely and protects the starter cat', () => {
    const simulation = fundedSimulation()
    const research = createResearch(simulation)
    simulation.hireCat()
    simulation.tick(5)
    simulation.assignCat('cat-2', research.id, research.slots[0].id)
    expect(cat(simulation, 'cat-2').status).toBe('travelling')
    const before = simulation.snapshot().economy.credits

    expect(simulation.dismissCat('cat-2')).toMatchObject({ ok: true })
    expect(simulation.snapshot().cats.some((candidate) => candidate.id === 'cat-2')).toBe(false)
    expect(node(simulation, 'research').slots[0]).toMatchObject({ catId: null, reservedByCatId: null, assignedCatId: null })
    expect(simulation.snapshot().economy.credits).toBeCloseTo(before - GAME_BALANCE.economy.dismissCatCost)
    expect(simulation.dismissCat('cat-1')).toMatchObject({ ok: false, reason: expect.stringContaining('Первого') })
  })

  it('warns at the debt threshold but can recover through continued trade', () => {
    let simulation = fundedSimulation()
    const server = simulation.createNode('server')
    const terminal = simulation.createNode('terminal')
    if (!server.ok || !terminal.ok) throw new Error('Missing recovery nodes')
    simulation.connect(server.value.id, terminal.value.id)
    const save = simulation.exportSave()
    save.simulation.economy.credits = GAME_BALANCE.economy.debtWarningThreshold
    save.simulation.nodes.find((candidate) => candidate.id === server.value.id)!.dataStored = 20
    const restored = Simulation.fromSave(save)
    if (!restored.ok) throw new Error(restored.reason)
    simulation = restored.value
    expect(simulation.snapshot().economy.debtWarning).toBe(true)
    expect(simulation.createNode('hub')).toMatchObject({ ok: false, reason: expect.stringContaining('Недостаточно') })

    simulation.tick(10)
    expect(simulation.snapshot().economy.credits).toBeGreaterThan(GAME_BALANCE.economy.debtWarningThreshold)
    expect(simulation.snapshot().economy.debtWarning).toBe(false)
  })

  it('starts stable-profit progress only after flight and at least two fully staffed clear research modules', () => {
    const missingScience = objectiveCandidate({ scienceProgress: GAME_BALANCE.science.flightUnlockProgress - 1 }).simulation
    missingScience.tick(1)
    expect(missingScience.snapshot().goal.profitableSeconds).toBe(0)

    const oneResearch = objectiveCandidate({ researchNodes: GAME_BALANCE.objective.requiredResearchNodes - 1 }).simulation
    oneResearch.tick(1)
    expect(oneResearch.snapshot().economy.revenuePerMinute).toBeGreaterThan(oneResearch.snapshot().economy.upkeepPerMinute)
    expect(oneResearch.snapshot().goal.profitableSeconds).toBe(0)

    const blockedResearch = objectiveCandidate()
    const blockedId = blockedResearch.researchIds[1]
    blockedResearch.simulation.setNodeBlocked(blockedId, true)
    blockedResearch.simulation.tick(1)
    expect(blockedResearch.simulation.snapshot().goal.profitableSeconds).toBe(0)

    const emptySlot = objectiveCandidate({ staffedResearchSlots: GAME_BALANCE.objective.requiredResearchNodes * GAME_BALANCE.nodes.research.slots - 1 }).simulation
    emptySlot.tick(1)
    expect(emptySlot.snapshot().goal.profitableSeconds).toBe(0)

    const extraUnstaffedResearch = objectiveCandidate({ researchNodes: 3, staffedResearchSlots: 4 }).simulation
    extraUnstaffedResearch.tick(1)
    expect(extraUnstaffedResearch.snapshot().goal.profitableSeconds).toBe(0)

    const ready = objectiveCandidate().simulation
    ready.tick(1)
    expect(ready.snapshot().economy.revenuePerMinute).toBeGreaterThan(ready.snapshot().economy.upkeepPerMinute)
    expect(ready.snapshot().nodes.filter((candidate) => candidate.type === 'research').flatMap((candidate) => candidate.slots)).toEqual(
      expect.arrayContaining([expect.objectContaining({ catId: null, assignedCatId: expect.any(String) })]),
    )
    expect(ready.snapshot().goal).toEqual({ achieved: false, acknowledged: false, profitableSeconds: 1, peakNetIncomePerMinute: GAME_BALANCE.objective.requiredPeakNetIncomePerMinute })
  })

  it('requires strictly positive income and resets partial progress on any failed running tick', () => {
    const zeroIncome = objectiveCandidate({ extraCats: 2 }).simulation
    zeroIncome.tick(1)
    expect(zeroIncome.snapshot().economy.revenuePerMinute).toBeCloseTo(zeroIncome.snapshot().economy.upkeepPerMinute)
    expect(zeroIncome.snapshot().goal.profitableSeconds).toBe(0)

    const candidate = objectiveCandidate({ profitableSeconds: 120 })
    candidate.simulation.tick(0)
    expect(candidate.simulation.snapshot().goal.profitableSeconds).toBe(120)
    candidate.simulation.setNodeBlocked(candidate.researchIds[1], true)
    candidate.simulation.tick(1)
    expect(candidate.simulation.snapshot().goal.profitableSeconds).toBe(0)

    const losingCandidate = objectiveCandidate({ profitableSeconds: 120, terminalNodes: 1 }).simulation
    losingCandidate.tick(1)
    expect(losingCandidate.snapshot().economy.revenuePerMinute).toBeLessThan(losingCandidate.snapshot().economy.upkeepPerMinute)
    expect(losingCandidate.snapshot().goal.profitableSeconds).toBe(0)
  })

  it('records the 500-per-minute net-income peak once and keeps it after income falls', () => {
    const belowTarget = objectiveCandidate({ terminalNodes: 15, peakNetIncomePerMinute: 0 }).simulation
    belowTarget.tick(1)
    const belowTargetIncome = belowTarget.snapshot().economy.revenuePerMinute - belowTarget.snapshot().economy.upkeepPerMinute
    expect(belowTargetIncome).toBeLessThan(GAME_BALANCE.objective.requiredPeakNetIncomePerMinute)
    expect(belowTarget.snapshot().goal.peakNetIncomePerMinute).toBeCloseTo(belowTargetIncome)

    const candidate = objectiveCandidate({ terminalNodes: 17, peakNetIncomePerMinute: 0 })
    candidate.simulation.tick(1)
    const reachedPeak = candidate.simulation.snapshot().economy.revenuePerMinute - candidate.simulation.snapshot().economy.upkeepPerMinute
    expect(reachedPeak).toBeGreaterThan(GAME_BALANCE.objective.requiredPeakNetIncomePerMinute)
    expect(candidate.simulation.snapshot().goal.peakNetIncomePerMinute).toBeCloseTo(reachedPeak)

    expect(candidate.simulation.deleteNode(candidate.terminalIds[0]).ok).toBe(true)
    expect(candidate.simulation.deleteNode(candidate.terminalIds[1]).ok).toBe(true)
    candidate.simulation.tick(1)
    expect(candidate.simulation.snapshot().economy.revenuePerMinute - candidate.simulation.snapshot().economy.upkeepPerMinute).toBeLessThan(GAME_BALANCE.objective.requiredPeakNetIncomePerMinute)
    expect(candidate.simulation.snapshot().goal.peakNetIncomePerMinute).toBeCloseTo(reachedPeak)
  })

  it('keeps the completed five-minute milestone while waiting for the independent income peak', () => {
    const simulation = objectiveCandidate({ terminalNodes: 15, peakNetIncomePerMinute: 0 }).simulation
    simulation.tick(GAME_BALANCE.objective.requiredProfitableSeconds)
    expect(simulation.snapshot().goal).toEqual({
      achieved: false,
      acknowledged: false,
      profitableSeconds: GAME_BALANCE.objective.requiredProfitableSeconds,
      peakNetIncomePerMinute: expect.any(Number),
    })

    const terminal = simulation.snapshot().nodes.find((candidate) => candidate.type === 'terminal')
    if (!terminal) throw new Error('Missing terminal')
    simulation.deleteNode(terminal.id)
    simulation.tick(1)
    expect(simulation.snapshot().goal.profitableSeconds).toBe(GAME_BALANCE.objective.requiredProfitableSeconds)
  })

  it('achieves the objective at exactly five profitable simulation minutes and keeps it sticky', () => {
    const candidate = objectiveCandidate()
    const simulation = candidate.simulation
    expect(simulation.acknowledgeGoal()).toMatchObject({ ok: false, reason: expect.stringContaining('ещё не') })
    simulation.tick(GAME_BALANCE.objective.requiredProfitableSeconds - 0.1)
    expect(simulation.snapshot().goal).toEqual({ achieved: false, acknowledged: false, profitableSeconds: GAME_BALANCE.objective.requiredProfitableSeconds - 0.1, peakNetIncomePerMinute: GAME_BALANCE.objective.requiredPeakNetIncomePerMinute })

    simulation.tick(0.1)
    expect(simulation.snapshot().goal).toEqual({ achieved: true, acknowledged: false, profitableSeconds: GAME_BALANCE.objective.requiredProfitableSeconds, peakNetIncomePerMinute: GAME_BALANCE.objective.requiredPeakNetIncomePerMinute })
    expect(simulation.deleteNode(candidate.researchIds[1]).ok).toBe(true)
    expect(simulation.deleteNode(candidate.terminalIds[1]).ok).toBe(true)
    simulation.tick(1)
    expect(simulation.snapshot().goal).toEqual({ achieved: true, acknowledged: false, profitableSeconds: GAME_BALANCE.objective.requiredProfitableSeconds, peakNetIncomePerMinute: GAME_BALANCE.objective.requiredPeakNetIncomePerMinute })
  })

  it('round-trips partial, peak, and acknowledged objective progress in version 5', () => {
    const partial = objectiveCandidate({ profitableSeconds: 123.45 }).simulation
    const partialSave = partial.exportSave()
    const partialRestored = Simulation.fromSave(JSON.parse(JSON.stringify(partialSave)))
    if (!partialRestored.ok) throw new Error(partialRestored.reason)
    expect(partialRestored.value.snapshot().goal.profitableSeconds).toBeCloseTo(123.45)
    expect(partialRestored.value.exportSave()).toEqual(partialSave)

    const achieved = objectiveCandidate().simulation
    achieved.tick(GAME_BALANCE.objective.requiredProfitableSeconds)
    expect(achieved.acknowledgeGoal().ok).toBe(true)
    const achievedSave = achieved.exportSave()
    const achievedRestored = Simulation.fromSave(JSON.parse(JSON.stringify(achievedSave)))
    if (!achievedRestored.ok) throw new Error(achievedRestored.reason)
    expect(achievedRestored.value.snapshot().goal).toEqual({
      achieved: true,
      acknowledged: true,
      profitableSeconds: GAME_BALANCE.objective.requiredProfitableSeconds,
      peakNetIncomePerMinute: GAME_BALANCE.objective.requiredPeakNetIncomePerMinute,
    })
  })

  it('round-trips versioned saves and rejects invalid versions or references atomically', () => {
    const simulation = fundedSimulation()
    const research = simulation.createNode('research')
    if (!research.ok) throw new Error(research.reason)
    simulation.setNodePosition(research.value.id, { x: 321, y: 123 })
    const serialized = JSON.parse(JSON.stringify(simulation.exportSave()))
    const restored = Simulation.fromSave(serialized)
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.reason)
    expect(restored.value.exportSave()).toEqual(serialized)

    expect(Simulation.fromSave({ ...serialized, version: 4 })).toMatchObject({ ok: false, reason: expect.stringContaining('верс') })
    const legacyShape = structuredClone(serialized)
    delete legacyShape.simulation.goal
    expect(Simulation.fromSave(legacyShape)).toMatchObject({ ok: false, reason: expect.stringContaining('структур') })
    const corrupt = structuredClone(serialized)
    corrupt.simulation.cats[0].nodeId = 'missing-node'
    expect(Simulation.fromSave(corrupt)).toMatchObject({ ok: false, reason: expect.stringContaining('ссыл') })
  })
})

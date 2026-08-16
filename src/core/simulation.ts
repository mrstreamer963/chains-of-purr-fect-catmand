import { GAME_BALANCE } from './balance'
import type { Cat, CommandResult, Connection, GameSaveV5, NodeType, Point, RoadPort, SimNode, SimulationSnapshot, SimulationStateV5, TravelLeg, UpkeepBreakdown, WorkerLink, WorkSlot } from './types'

const REST_ID = 'rest-1'
const CAT_NAMES = ['Мира', 'Нокс', 'Север', 'Иней', 'Пиксель']
const CAT_VARIANTS = ['◕', '◔', '◑', '◒', '◐']
const EPSILON = 0.000001
const SAVE_VERSION = 5

function catName(index: number) {
  const baseName = CAT_NAMES[index % CAT_NAMES.length]
  const generation = Math.floor(index / CAT_NAMES.length) + 1
  return generation === 1 ? baseName : `${baseName} ${generation}`
}

function slots(nodeId: string, amount: number): WorkSlot[] {
  return Array.from({ length: amount }, (_, index) => ({ id: `${nodeId}-slot-${index + 1}`, catId: null, reservedByCatId: null, assignedCatId: null }))
}

function copyNode(node: SimNode): SimNode {
  return { ...node, position: { ...(node.position ?? { x: 0, y: 0 }) }, slots: node.slots.map((slot) => ({ ...slot })) }
}

function copyCat(cat: Cat): Cat {
  return {
    ...cat,
    travel: cat.travel ? cat.travel.kind === 'road' ? { ...cat.travel, leg: { ...cat.travel.leg } } : { ...cat.travel } : null,
    stranded: cat.stranded ? { ...cat.stranded } : null,
  }
}

function roadPorts(type: NodeType): RoadPort[] {
  return type === 'hub' ? ['north', 'east', 'south', 'west'] : ['road']
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isWorkSlot(value: unknown): value is WorkSlot {
  return isRecord(value) && typeof value.id === 'string' && isNullableString(value.catId)
    && isNullableString(value.reservedByCatId) && isNullableString(value.assignedCatId)
}

function isSimNode(value: unknown): value is SimNode {
  return isRecord(value) && typeof value.id === 'string'
    && ['rest', 'research', 'server', 'hub', 'terminal'].includes(String(value.type))
    && typeof value.name === 'string' && (value.blocked === undefined || typeof value.blocked === 'boolean')
    && isRecord(value.position) && isFiniteNumber(value.position.x) && isFiniteNumber(value.position.y)
    && Array.isArray(value.slots) && value.slots.every(isWorkSlot)
    && ['dataBuffer', 'dataStored', 'dataSold', 'productionRate', 'inputRate', 'outputRate'].every((key) => isFiniteNumber(value[key]) && Number(value[key]) >= 0)
}

function isConnection(value: unknown): value is Connection {
  return isRecord(value) && typeof value.id === 'string' && typeof value.sourceId === 'string'
    && typeof value.targetId === 'string' && value.resource === 'data'
}

function isWorkerLink(value: unknown): value is WorkerLink {
  return isRecord(value) && typeof value.id === 'string' && typeof value.nodeAId === 'string' && typeof value.nodeBId === 'string'
    && ['road', 'north', 'east', 'south', 'west'].includes(String(value.nodeAPort))
    && ['road', 'north', 'east', 'south', 'west'].includes(String(value.nodeBPort))
    && isFiniteNumber(value.travelSeconds) && value.travelSeconds > 0
}

function isCat(value: unknown): value is Cat {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.variant !== 'string'
    || typeof value.nodeId !== 'string' || !isNullableString(value.slotId)
    || !['idle', 'travelling', 'stranded'].includes(String(value.status)) || !isFiniteNumber(value.vigor)) return false
  if (value.stranded !== undefined && value.stranded !== null && (!isRecord(value.stranded)
    || typeof value.stranded.targetNodeId !== 'string' || !isNullableString(value.stranded.targetSlotId) || typeof value.stranded.sourceNodeId !== 'string')) return false
  if (value.travel === null) return true
  if (!isRecord(value.travel) || !['road', 'flight'].includes(String(value.travel.kind))
    || typeof value.travel.targetNodeId !== 'string' || typeof value.travel.targetSlotId !== 'string' || typeof value.travel.sourceNodeId !== 'string') return false
  if (value.travel.kind === 'road') return isRecord(value.travel.leg) && typeof value.travel.leg.linkId === 'string'
    && typeof value.travel.leg.fromNodeId === 'string' && typeof value.travel.leg.toNodeId === 'string'
    && isFiniteNumber(value.travel.legProgress)
  return typeof value.travel.fromNodeId === 'string' && isNullableString(value.travel.fromSlotId)
    && isFiniteNumber(value.travel.flightDurationSeconds) && value.travel.flightDurationSeconds > 0
    && isFiniteNumber(value.travel.flightProgress)
}

export class Simulation {
  private readonly nodes = new Map<string, SimNode>()
  private readonly cats = new Map<string, Cat>()
  private readonly connections = new Map<string, Connection>()
  private readonly workerLinks = new Map<string, WorkerLink>()
  private nodeCounter = 0
  private catCounter = 0
  private flightUnlocked = false
  private scienceProgress = 0
  private credits: number = GAME_BALANCE.economy.startingCredits
  private totalEarned = 0
  private totalSpent = 0
  private totalDataSold = 0
  private lastRevenuePerMinute = 0
  private goalAchieved = false
  private goalAcknowledged = false
  private profitableSeconds = 0
  private peakNetIncomePerMinute = 0

  constructor(initialize = true) {
    if (!initialize) return
    this.nodes.set(REST_ID, {
      id: REST_ID, type: 'rest', name: 'Комната отдыха', slots: slots(REST_ID, GAME_BALANCE.nodes.rest.slots),
      blocked: false,
      position: { x: 80, y: 270 },
      dataBuffer: 0, dataStored: 0, dataSold: 0, productionRate: 0, inputRate: 0, outputRate: 0,
    })
    this.addCat(GAME_BALANCE.cats.maxVigor)
  }

  snapshot(): SimulationSnapshot {
    const upkeepBreakdown = this.upkeepBreakdown()
    return {
      nodes: [...this.nodes.values()].map(copyNode),
      cats: [...this.cats.values()].map(copyCat),
      connections: [...this.connections.values()].map((connection) => ({ ...connection })),
      workerLinks: [...this.workerLinks.values()].map((link) => ({ ...link })),
      flightUnlocked: this.flightUnlocked,
      scienceProgress: this.scienceProgress,
      economy: {
        credits: this.credits,
        totalEarned: this.totalEarned,
        totalSpent: this.totalSpent,
        totalDataSold: this.totalDataSold,
        upkeepPerMinute: this.totalUpkeep(upkeepBreakdown),
        upkeepBreakdown,
        revenuePerMinute: this.lastRevenuePerMinute,
        debtWarning: this.credits <= GAME_BALANCE.economy.debtWarningThreshold,
      },
      goal: { achieved: this.goalAchieved, acknowledged: this.goalAcknowledged, profitableSeconds: this.profitableSeconds, peakNetIncomePerMinute: this.peakNetIncomePerMinute },
    }
  }

  exportSave(): GameSaveV5 {
    const snapshot = this.snapshot()
    return {
      version: SAVE_VERSION,
      simulation: {
        nodes: snapshot.nodes,
        cats: snapshot.cats,
        connections: snapshot.connections,
        workerLinks: snapshot.workerLinks,
        nodeCounter: this.nodeCounter,
        catCounter: this.catCounter,
        flightUnlocked: this.flightUnlocked,
        scienceProgress: this.scienceProgress,
        economy: { credits: this.credits, totalEarned: this.totalEarned, totalSpent: this.totalSpent, totalDataSold: this.totalDataSold },
        goal: { achieved: this.goalAchieved, acknowledged: this.goalAcknowledged, profitableSeconds: this.profitableSeconds, peakNetIncomePerMinute: this.peakNetIncomePerMinute },
      },
    }
  }

  static fromSave(value: unknown): CommandResult<Simulation> {
    if (!isRecord(value) || value.version !== SAVE_VERSION) return { ok: false, reason: 'Несовместимая версия сохранения.' }
    const state = value.simulation
    if (!isRecord(state) || !Array.isArray(state.nodes) || !state.nodes.every(isSimNode)
      || !Array.isArray(state.cats) || !state.cats.every(isCat)
      || !Array.isArray(state.connections) || !state.connections.every(isConnection)
      || !Array.isArray(state.workerLinks) || !state.workerLinks.every(isWorkerLink)
      || !Number.isInteger(state.nodeCounter) || Number(state.nodeCounter) < 0
      || !Number.isInteger(state.catCounter) || Number(state.catCounter) < 1
      || typeof state.flightUnlocked !== 'boolean' || !isFiniteNumber(state.scienceProgress) || state.scienceProgress < 0
      || !isRecord(state.economy) || !isFiniteNumber(state.economy.credits)
      || !isFiniteNumber(state.economy.totalEarned) || state.economy.totalEarned < 0
      || !isFiniteNumber(state.economy.totalSpent) || state.economy.totalSpent < 0
      || !isFiniteNumber(state.economy.totalDataSold) || state.economy.totalDataSold < 0
      || !isRecord(state.goal) || typeof state.goal.achieved !== 'boolean' || typeof state.goal.acknowledged !== 'boolean'
      || !isFiniteNumber(state.goal.peakNetIncomePerMinute) || state.goal.peakNetIncomePerMinute < 0
      || !isFiniteNumber(state.goal.profitableSeconds) || state.goal.profitableSeconds < 0
      || state.goal.profitableSeconds > GAME_BALANCE.objective.requiredProfitableSeconds + EPSILON) {
      return { ok: false, reason: 'Сохранение повреждено или имеет неверную структуру.' }
    }
    const loaded = new Simulation(false)
    const typedState = state as unknown as SimulationStateV5
    if (!loaded.restoreState(typedState)) return { ok: false, reason: 'Сохранение содержит повреждённые ссылки или топологию.' }
    return { ok: true, value: loaded }
  }

  acknowledgeGoal(): CommandResult<void> {
    if (!this.goalAchieved) return { ok: false, reason: 'Цель лаборатории ещё не достигнута.' }
    this.goalAcknowledged = true
    return { ok: true, value: undefined }
  }

  createNode(type: NodeType): CommandResult<SimNode> {
    const price = GAME_BALANCE.nodes[type].cost
    if (this.credits + EPSILON < price) return { ok: false, reason: `Недостаточно кредитов: требуется ${price}.` }
    let id: string
    do {
      this.nodeCounter += 1
      id = `${type}-${this.nodeCounter}`
    } while (this.nodes.has(id))
    const node: SimNode = {
      id,
      type,
      name: type === 'rest' ? 'Комната отдыха' : type === 'research' ? 'Исследования' : type === 'server' ? 'Сервер данных' : type === 'hub' ? 'Дорожный хаб' : 'Торговый терминал',
      blocked: false,
      position: { x: 0, y: 0 },
      slots: slots(id, GAME_BALANCE.nodes[type].slots),
      dataBuffer: 0, dataStored: 0, dataSold: 0, productionRate: 0, inputRate: 0, outputRate: 0,
    }
    this.nodes.set(id, node)
    this.spend(price)
    if (type === 'rest') {
      this.seatWaitingCats()
      this.resumeStrandedCats()
    }
    return { ok: true, value: copyNode(node) }
  }

  deleteNode(nodeId: string): CommandResult<void> {
    const node = this.nodes.get(nodeId)
    if (!node) return { ok: false, reason: 'Модуль не найден.' }
    if (node.type === 'hub') return { ok: false, reason: 'Дорожный хаб удаляется отдельной командой.' }
    if (nodeId === REST_ID) return { ok: false, reason: 'Базовую комнату отдыха удалить нельзя.' }

    const evacuations = [...this.cats.values()]
      .sort((first, second) => first.id.localeCompare(second.id))
      .flatMap((cat) => {
        const travel = cat.travel
        const losesCurrentModule = cat.nodeId === nodeId || (travel?.kind === 'flight' && travel.fromNodeId === nodeId)
        const losesFinalTarget = travel?.targetNodeId === nodeId || cat.stranded?.targetNodeId === nodeId
        const losesRoadStart = travel?.kind === 'road' && travel.leg.fromNodeId === nodeId
        if (!losesCurrentModule && !losesFinalTarget && !losesRoadStart) return []
        return [{ cat, position: this.catPosition(cat) }]
      })
    const evacuationIds = new Set(evacuations.map(({ cat }) => cat.id))
    const interruptedRoadCats = [...this.cats.values()]
      .filter((cat) => !evacuationIds.has(cat.id)
        && cat.travel?.kind === 'road'
        && cat.travel.leg.toNodeId === nodeId
        && cat.travel.targetNodeId !== nodeId)
      .sort((first, second) => first.id.localeCompare(second.id))

    for (const { cat } of evacuations) {
      this.releaseCatOccupancyAndReservations(cat.id)
      cat.slotId = null
      cat.status = 'idle'
      cat.travel = null
      cat.stranded = null
    }
    for (const cat of interruptedRoadCats) {
      const travel = cat.travel
      if (!travel || travel.kind !== 'road') continue
      cat.nodeId = travel.leg.fromNodeId
      cat.slotId = null
      cat.status = 'stranded'
      cat.stranded = { targetNodeId: travel.targetNodeId, targetSlotId: travel.targetSlotId, sourceNodeId: travel.sourceNodeId }
      cat.travel = null
    }

    for (const connection of this.connections.values()) {
      if (connection.sourceId === nodeId || connection.targetId === nodeId) this.connections.delete(connection.id)
    }
    for (const link of this.linksForNode(nodeId)) this.workerLinks.delete(link.id)
    this.nodes.delete(nodeId)
    this.credits += GAME_BALANCE.nodes[node.type].cost * GAME_BALANCE.economy.demolitionRefundRatio

    for (const { cat, position } of evacuations) {
      const restSeat = this.findNearestRestSeat(position)
      cat.nodeId = restSeat?.node.id ?? REST_ID
      cat.slotId = restSeat?.slot.id ?? null
      if (restSeat) restSeat.slot.catId = cat.id
    }
    this.resumeStrandedCats()
    return { ok: true, value: undefined }
  }

  hubDeletionImpact(hubId: string): CommandResult<string[]> {
    const hub = this.nodes.get(hubId)
    if (hub?.type !== 'hub') return { ok: false, reason: 'Дорожный хаб не найден.' }
    const incidentIds = new Set(this.linksForNode(hubId).map((link) => link.id))
    return {
      ok: true,
      value: [...this.cats.values()]
        .filter((cat) => cat.nodeId === hubId || (cat.status === 'travelling' && cat.travel?.kind === 'road' && incidentIds.has(cat.travel.leg.linkId)))
        .map((cat) => cat.id),
    }
  }

  deleteRoadHub(hubId: string, rescueHubByCatId: Record<string, string>): CommandResult<void> {
    const impact = this.hubDeletionImpact(hubId)
    if (!impact.ok) return impact
    const survivingHubIds = [...this.nodes.values()].filter((node) => node.type === 'hub' && node.id !== hubId).map((node) => node.id)
    for (const catId of impact.value) {
      if (!survivingHubIds.length) continue
      if (!survivingHubIds.includes(rescueHubByCatId[catId])) return { ok: false, reason: 'Для каждого затронутого кота нужен существующий дорожный хаб.' }
    }

    for (const link of this.linksForNode(hubId)) this.workerLinks.delete(link.id)
    this.nodes.delete(hubId)
    this.credits += GAME_BALANCE.nodes.hub.cost * GAME_BALANCE.economy.demolitionRefundRatio
    for (const catId of impact.value) {
      const cat = this.cats.get(catId)
      if (!cat) continue
      const target = cat.travel
        ? { targetNodeId: cat.travel.targetNodeId, targetSlotId: cat.travel.targetSlotId, sourceNodeId: cat.travel.sourceNodeId }
        : cat.stranded
      if (!target) continue
      cat.nodeId = survivingHubIds.length ? rescueHubByCatId[cat.id] : target.sourceNodeId
      cat.slotId = null
      cat.status = 'stranded'
      cat.travel = null
      cat.stranded = { ...target }
    }
    this.resumeStrandedCats()
    return { ok: true, value: undefined }
  }

  hireCat(): CommandResult<Cat> {
    const price = GAME_BALANCE.economy.hireCatCost
    if (this.credits + EPSILON < price) return { ok: false, reason: `Недостаточно кредитов: требуется ${price}.` }
    const result = this.addCat(0)
    if (result.ok) this.spend(price)
    return result
  }

  dismissCat(catId: string): CommandResult<void> {
    const cat = this.cats.get(catId)
    if (!cat) return { ok: false, reason: 'Кот не найден.' }
    if (catId === 'cat-1') return { ok: false, reason: 'Первого кота увольнять нельзя.' }
    this.releaseCatOccupancyAndReservations(catId)
    this.clearWorkAssignmentForCat(catId)
    this.cats.delete(catId)
    this.spend(GAME_BALANCE.economy.dismissCatCost)
    this.seatWaitingCats()
    this.resumeStrandedCats()
    return { ok: true, value: undefined }
  }

  setNodeBlocked(nodeId: string, blocked: boolean): CommandResult<void> {
    const node = this.nodes.get(nodeId)
    if (!node) return { ok: false, reason: 'Модуль не найден.' }
    node.blocked = blocked
    return { ok: true, value: undefined }
  }

  setNodePosition(nodeId: string, position: Point): CommandResult<void> {
    const node = this.nodes.get(nodeId)
    if (!node) return { ok: false, reason: 'Модуль не найден.' }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return { ok: false, reason: 'Координаты модуля должны быть конечными числами.' }
    node.position = { ...position }
    return { ok: true, value: undefined }
  }

  private addCat(vigor: number): CommandResult<Cat> {
    this.catCounter += 1
    const index = this.catCounter - 1
    const cat: Cat = {
      id: `cat-${this.catCounter}`, name: catName(index), variant: CAT_VARIANTS[index % CAT_VARIANTS.length],
      nodeId: REST_ID, slotId: null, status: 'idle', travel: null, stranded: null, vigor,
    }
    this.cats.set(cat.id, cat)
    this.seatWaitingCats()
    return { ok: true, value: copyCat(cat) }
  }

  assignCat(catId: string, nodeId: string, slotId: string): CommandResult<void> {
    const cat = this.cats.get(catId)
    const node = this.nodes.get(nodeId)
    const targetSlot = node?.slots.find((slot) => slot.id === slotId)
    const currentNode = cat ? this.nodes.get(cat.nodeId) : undefined
    const currentSlot = cat?.slotId ? currentNode?.slots.find((slot) => slot.id === cat.slotId) : undefined
    const isWorking = Boolean(currentSlot?.catId === catId && currentNode && currentNode.type !== 'rest' && currentNode.type !== 'hub')
    if (!cat) return { ok: false, reason: 'Кот не найден.' }
    if (node?.blocked || (cat.status === 'idle' && currentNode?.blocked)) return { ok: false, reason: 'Перекрытый модуль недоступен.' }
    if (!node || node.type === 'rest' || node.type === 'hub') return { ok: false, reason: 'Рабочий слот не найден.' }
    if (!targetSlot) return { ok: false, reason: 'Рабочий слот не найден.' }
    if (targetSlot.catId || targetSlot.reservedByCatId) return { ok: false, reason: 'Этот слот уже занят или зарезервирован.' }
    if (cat.status === 'idle' && !isWorking && cat.nodeId === nodeId) return { ok: false, reason: 'Кот уже находится в этом модуле.' }

    const activeTarget = this.activeTarget(cat)
    if (activeTarget) {
      this.clearWorkAssignmentForCat(cat.id)
      targetSlot.assignedCatId = cat.id
      if (activeTarget.node.type === 'rest') return { ok: true, value: undefined }

      const rollbackNodeId = cat.travel
        ? cat.travel.kind === 'road' ? cat.travel.leg.fromNodeId : cat.travel.fromNodeId
        : cat.nodeId
      this.releaseCatReservations(cat.id)
      cat.nodeId = rollbackNodeId
      cat.slotId = null
      cat.status = 'idle'
      cat.travel = null
      cat.stranded = null
      this.moveCatToTargetOrStrand(cat, node.id, targetSlot.id)
      return { ok: true, value: undefined }
    }

    this.clearWorkAssignmentForCat(cat.id)
    targetSlot.assignedCatId = cat.id
    if (isWorking && currentSlot && currentNode) {
      if (currentNode.id === node.id) {
        currentSlot.catId = null
        targetSlot.catId = cat.id
        cat.slotId = targetSlot.id
        return { ok: true, value: undefined }
      }
      this.moveCatToTargetOrStrand(cat, node.id, targetSlot.id)
      return { ok: true, value: undefined }
    }
    this.returnRecoveredCatsToAssignedSlots()
    this.seatWaitingCats()
    this.resumeStrandedCats()
    return { ok: true, value: undefined }
  }

  cancelCatWorkDestination(catId: string): CommandResult<void> {
    const cat = this.cats.get(catId)
    if (!cat) return { ok: false, reason: 'Кот не найден.' }
    const activeTarget = this.activeTarget(cat)
    if (!activeTarget || activeTarget.node.type === 'rest' || activeTarget.node.type === 'hub') {
      return { ok: false, reason: 'У кота нет активной рабочей цели.' }
    }

    const rollbackNodeId = cat.travel
      ? cat.travel.kind === 'road' ? cat.travel.leg.fromNodeId : cat.travel.fromNodeId
      : cat.nodeId
    this.clearWorkAssignmentForCat(cat.id)
    this.releaseCatReservations(cat.id)
    cat.nodeId = rollbackNodeId
    cat.slotId = null
    cat.status = 'idle'
    cat.travel = null
    cat.stranded = null
    this.sendCatToRest(cat)
    return { ok: true, value: undefined }
  }

  clearWorkAssignment(nodeId: string, slotId: string): CommandResult<void> {
    const node = this.nodes.get(nodeId)
    if (!node || node.type === 'rest' || node.type === 'hub') return { ok: false, reason: 'Рабочий слот не найден.' }
    const slot = node.slots.find((candidate) => candidate.id === slotId)
    if (!slot) return { ok: false, reason: 'Рабочий слот не найден.' }
    if (slot.catId) return { ok: false, reason: 'Работающего кота нужно сначала выбрать повторным кликом.' }
    if (slot.reservedByCatId) return { ok: false, reason: 'Нельзя снять назначение, пока кот в пути.' }
    if (!slot.assignedCatId) return { ok: false, reason: 'У этого слота нет назначения.' }
    slot.assignedCatId = null
    return { ok: true, value: undefined }
  }

  releaseCat(catId: string): CommandResult<void> {
    const cat = this.cats.get(catId)
    if (!cat) return { ok: false, reason: 'Кот не найден.' }
    const currentNode = this.nodes.get(cat.nodeId)
    const currentSlot = cat.slotId ? currentNode?.slots.find((slot) => slot.id === cat.slotId) : undefined
    if (currentNode?.blocked) return { ok: false, reason: 'Перекрытый модуль недоступен.' }
    if (cat.status === 'travelling' || cat.status === 'stranded') return { ok: false, reason: 'Кот уже следует к назначенной цели.' }
    if (currentNode?.type === 'rest') return { ok: false, reason: 'Кот уже отдыхает.' }
    if (!currentSlot || currentSlot.catId !== cat.id) return { ok: false, reason: 'Кот не занимает рабочий слот.' }

    this.clearWorkAssignmentForCat(cat.id)
    this.sendCatToRest(cat)
    return { ok: true, value: undefined }
  }

  canConnect(sourceId: string, targetId: string): CommandResult<void> {
    const source = this.nodes.get(sourceId)
    const target = this.nodes.get(targetId)
    if (!source || !target) return { ok: false, reason: 'Один из модулей не найден.' }
    if (source?.blocked || target?.blocked) return { ok: false, reason: 'Перекрытый модуль недоступен.' }
    if (sourceId === targetId) return { ok: false, reason: 'Нельзя соединить модуль с самим собой.' }
    const compatible = (source.type === 'research' && target.type === 'server')
      || (source.type === 'server' && target.type === 'server')
      || (source.type === 'server' && target.type === 'terminal')
    if (!compatible) return { ok: false, reason: 'Несовместимые порты данных.' }
    const connection = { id: `data-${sourceId}--${targetId}`, sourceId, targetId, resource: 'data' as const }
    if (this.connections.has(connection.id)) return { ok: false, reason: 'Этот канал данных уже существует.' }
    if (target.type === 'terminal' && [...this.connections.values()].some((candidate) => candidate.targetId === targetId)) return { ok: false, reason: 'Вход данных этого терминала уже занят.' }
    if (source.type === 'server' && target.type === 'server' && this.hasDataPath(targetId, sourceId)) return { ok: false, reason: 'Канал данных создаст цикл.' }
    return { ok: true, value: undefined }
  }

  connect(sourceId: string, targetId: string): CommandResult<Connection> {
    const validation = this.canConnect(sourceId, targetId)
    if (!validation.ok) return validation
    const connection = { id: `data-${sourceId}--${targetId}`, sourceId, targetId, resource: 'data' as const }
    this.connections.set(connection.id, connection)
    return { ok: true, value: { ...connection } }
  }

  disconnect(connectionId: string): CommandResult<void> {
    if (!this.connections.has(connectionId)) return { ok: false, reason: 'Канал данных не найден.' }
    this.connections.delete(connectionId)
    return { ok: true, value: undefined }
  }

  connectWorkerNodes(nodeAId: string, nodeBId: string, travelSeconds: number, nodeAPort: RoadPort = 'road', nodeBPort: RoadPort = 'road'): CommandResult<WorkerLink> {
    const nodeA = this.nodes.get(nodeAId)
    const nodeB = this.nodes.get(nodeBId)
    if (!nodeA || !nodeB) return { ok: false, reason: 'Один из модулей не найден.' }
    if (nodeA.blocked || nodeB.blocked) return { ok: false, reason: 'Перекрытый модуль недоступен.' }
    if (nodeAId === nodeBId) return { ok: false, reason: 'Нельзя соединить модуль с самим собой.' }
    if (!Number.isFinite(travelSeconds) || travelSeconds <= 0) return { ok: false, reason: 'Время перехода должно быть положительным.' }
    if (!roadPorts(nodeA.type).includes(nodeAPort) || !roadPorts(nodeB.type).includes(nodeBPort)) return { ok: false, reason: 'У выбранного модуля нет такого дорожного порта.' }
    if (this.linksForPort(nodeAId, nodeAPort).length || this.linksForPort(nodeBId, nodeBPort).length) return { ok: false, reason: 'Этот дорожный порт уже занят.' }

    const [first, second, firstPort, secondPort] = nodeAId.localeCompare(nodeBId) < 0
      ? [nodeAId, nodeBId, nodeAPort, nodeBPort]
      : [nodeBId, nodeAId, nodeBPort, nodeAPort]
    const id = `worker-${first}:${firstPort}--${second}:${secondPort}`
    if (this.workerLinks.has(id)) return { ok: false, reason: 'Переход между этими портами уже существует.' }
    const link = { id, nodeAId: first, nodeBId: second, nodeAPort: firstPort, nodeBPort: secondPort, travelSeconds }
    this.workerLinks.set(id, link)
    this.resumeStrandedCats()
    this.returnRecoveredCatsToAssignedSlots()
    return { ok: true, value: { ...link } }
  }

  disconnectWorkerLink(linkId: string): CommandResult<void> {
    if (!this.workerLinks.has(linkId)) return { ok: false, reason: 'Переход для котов не найден.' }
    for (const cat of this.cats.values()) {
      if (cat.travel?.kind !== 'road' || cat.travel.leg.linkId !== linkId) continue
      const travel = cat.travel
      cat.nodeId = travel.leg.fromNodeId
      cat.slotId = null
      cat.status = 'stranded'
      cat.stranded = { targetNodeId: travel.targetNodeId, targetSlotId: travel.targetSlotId, sourceNodeId: travel.sourceNodeId }
      cat.travel = null
    }
    this.workerLinks.delete(linkId)
    this.resumeStrandedCats()
    return { ok: true, value: undefined }
  }

  updateWorkerLinkTravelTime(linkId: string, travelSeconds: number): CommandResult<void> {
    const link = this.workerLinks.get(linkId)
    if (!link) return { ok: false, reason: 'Переход для котов не найден.' }
    if (!Number.isFinite(travelSeconds) || travelSeconds <= 0) return { ok: false, reason: 'Время перехода должно быть положительным.' }
    link.travelSeconds = travelSeconds
    return { ok: true, value: undefined }
  }

  tick(deltaSeconds: number): CommandResult<void> {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return { ok: false, reason: 'Время симуляции должно быть неотрицательным числом.' }
    const activeSecondsByNode = new Map<string, number>()
    for (const cat of this.cats.values()) {
      const activeSeconds = this.advanceCat(cat, deltaSeconds)
      if (activeSeconds <= 0) continue
      const currentNode = this.nodes.get(cat.nodeId)
      if (currentNode?.blocked) continue
      if (currentNode?.type === 'rest') {
        if (!cat.slotId) continue
        cat.vigor = Math.min(GAME_BALANCE.cats.maxVigor, cat.vigor + activeSeconds * GAME_BALANCE.cats.restVigorRecoveryPerSecond)
        continue
      }
      if (currentNode?.type === 'hub') continue
      const workSeconds = Math.min(activeSeconds, cat.vigor / GAME_BALANCE.cats.workVigorDrainPerSecond)
      if (workSeconds > 0) {
        activeSecondsByNode.set(cat.nodeId, (activeSecondsByNode.get(cat.nodeId) ?? 0) + workSeconds)
        cat.vigor = Math.max(0, cat.vigor - workSeconds * GAME_BALANCE.cats.workVigorDrainPerSecond)
      }
      if (cat.vigor <= EPSILON) this.returnTiredCat(cat)
    }
    this.seatWaitingCats()
    this.returnRecoveredCatsToAssignedSlots()
    this.resumeStrandedCats()
    for (const node of this.nodes.values()) {
      node.productionRate = 0
      node.inputRate = 0
      node.outputRate = 0
      const activeSeconds = activeSecondsByNode.get(node.id) ?? 0
      if (node.type === 'research' && activeSeconds > 0) {
        const science = activeSeconds * GAME_BALANCE.science.progressPerWorkSecond
        const data = activeSeconds * GAME_BALANCE.science.dataPerWorkSecond
        node.productionRate = data / deltaSeconds
        node.dataBuffer += data
        this.scienceProgress += science
      }
    }
    if (deltaSeconds === 0) return { ok: true, value: undefined }
    for (const server of this.dataOrderedServers()) {
      if (server.type !== 'server' || server.blocked) continue
      const serverWorkerSeconds = activeSecondsByNode.get(server.id) ?? 0
      const capacity = GAME_BALANCE.data.serverBaseCapacityPerSecond * deltaSeconds
        + GAME_BALANCE.data.serverOperatorCapacityPerWorkSecond * serverWorkerSeconds
      const transferred = this.pullData(server.id, capacity, deltaSeconds)
      server.dataStored += transferred
      server.inputRate = transferred / deltaSeconds
    }
    let revenue = 0
    let dataSold = 0
    for (const terminal of this.nodes.values()) {
      if (terminal.type !== 'terminal' || terminal.blocked) continue
      const operatorSeconds = activeSecondsByNode.get(terminal.id) ?? 0
      const capacity = GAME_BALANCE.trade.baseCapacityPerSecond * deltaSeconds
        + GAME_BALANCE.trade.operatorCapacityPerWorkSecond * operatorSeconds
      const sold = this.pullData(terminal.id, capacity, deltaSeconds)
      terminal.dataSold += sold
      terminal.inputRate = sold / deltaSeconds
      dataSold += sold
      revenue += sold * GAME_BALANCE.economy.dataSalePrice
    }
    const upkeep = this.upkeepPerMinute() * deltaSeconds / 60
    this.credits += revenue - upkeep
    this.totalEarned += revenue
    this.totalSpent += upkeep
    this.totalDataSold += dataSold
    this.lastRevenuePerMinute = revenue / deltaSeconds * 60
    this.unlockFlightIfReady()
    this.updateGoalProgress(deltaSeconds)
    return { ok: true, value: undefined }
  }

  private moveCatToTargetOrStrand(cat: Cat, targetNodeId: string, targetSlotId: string) {
    const currentSlot = cat.slotId ? this.nodes.get(cat.nodeId)?.slots.find((slot) => slot.id === cat.slotId) : undefined
    const targetSlot = this.nodes.get(targetNodeId)?.slots.find((slot) => slot.id === targetSlotId)
    if (!targetSlot) return

    const sourceNodeId = cat.nodeId
    const sourceSlotId = currentSlot?.id ?? null
    if (currentSlot) currentSlot.catId = null
    if (sourceNodeId === targetNodeId) {
      targetSlot.reservedByCatId = null
      targetSlot.catId = cat.id
      cat.slotId = targetSlot.id
      cat.status = 'idle'
      cat.travel = null
      cat.stranded = null
      return
    }
    targetSlot.reservedByCatId = cat.id
    cat.slotId = null
    cat.stranded = null

    if (this.flightUnlocked && !this.nodes.get(sourceNodeId)?.blocked && !this.nodes.get(targetNodeId)?.blocked) {
      cat.status = 'travelling'
      cat.travel = this.flightTravel(sourceNodeId, targetNodeId, targetSlotId, sourceNodeId, sourceSlotId)
      return
    }

    const path = this.findPath(sourceNodeId, targetNodeId)
    if (path?.length) {
      cat.status = 'travelling'
      cat.travel = { kind: 'road', targetNodeId, targetSlotId, sourceNodeId, leg: path[0], legProgress: 0 }
      return
    }

    cat.status = 'stranded'
    cat.travel = null
    cat.stranded = { targetNodeId, targetSlotId, sourceNodeId }
  }

  private activeTarget(cat: Cat): { node: SimNode; slot: WorkSlot | null } | null {
    const target = cat.travel ?? cat.stranded
    if (!target) return null
    const node = this.nodes.get(target.targetNodeId)
    if (!node) return null
    const slot = target.targetSlotId ? node.slots.find((candidate) => candidate.id === target.targetSlotId) ?? null : null
    return { node, slot }
  }

  private sendCatToRest(cat: Cat) {
    const restSlot = this.findRestSeat()
    if (restSlot) {
      this.moveCatToTargetOrStrand(cat, restSlot.node.id, restSlot.slot.id)
      return
    }

    const currentSlot = cat.slotId ? this.nodes.get(cat.nodeId)?.slots.find((slot) => slot.id === cat.slotId) : undefined
    if (currentSlot) currentSlot.catId = null
    cat.slotId = null
    cat.status = 'stranded'
    cat.travel = null
    cat.stranded = { targetNodeId: REST_ID, targetSlotId: null, sourceNodeId: cat.nodeId }
  }

  private startTravel(cat: Cat, targetNodeId: string, targetSlotId: string): CommandResult<void> {
    if (this.nodes.get(cat.nodeId)?.blocked || this.nodes.get(targetNodeId)?.blocked) return { ok: false, reason: 'Перекрытый модуль недоступен.' }
    const path = this.flightUnlocked ? null : this.findPath(cat.nodeId, targetNodeId)
    if (!this.flightUnlocked && !path?.length) return { ok: false, reason: 'Нет маршрута для кота. Создайте двунаправленные переходы.' }
    const currentSlot = cat.slotId ? this.nodes.get(cat.nodeId)?.slots.find((slot) => slot.id === cat.slotId) : null
    const targetSlot = this.nodes.get(targetNodeId)?.slots.find((slot) => slot.id === targetSlotId)
    if (!targetSlot) return { ok: false, reason: 'Назначение кота повреждено.' }
    if (currentSlot) currentSlot.catId = null
    targetSlot.reservedByCatId = cat.id
    cat.slotId = null
    cat.status = 'travelling'
    cat.stranded = null
    cat.travel = this.flightUnlocked
      ? this.flightTravel(cat.nodeId, targetNodeId, targetSlotId, cat.nodeId, currentSlot?.id ?? null)
      : { kind: 'road', targetNodeId, targetSlotId, sourceNodeId: cat.nodeId, leg: path![0], legProgress: 0 }
    return { ok: true, value: undefined }
  }

  private continueTravel(cat: Cat): boolean {
    if (!cat.travel || cat.travel.kind !== 'road') return false
    if (this.flightUnlocked) {
      cat.travel = this.flightTravel(cat.nodeId, cat.travel.targetNodeId, cat.travel.targetSlotId, cat.travel.sourceNodeId, null)
      return true
    }
    const path = this.findPath(cat.nodeId, cat.travel.targetNodeId)
    if (!path?.length) {
      cat.status = 'stranded'
      cat.stranded = { targetNodeId: cat.travel.targetNodeId, targetSlotId: cat.travel.targetSlotId, sourceNodeId: cat.travel.sourceNodeId }
      cat.travel = null
      return false
    }
    cat.travel.leg = path[0]
    cat.travel.legProgress = 0
    return true
  }

  private resumeStrandedCats() {
    for (const cat of this.cats.values()) {
      if (cat.status !== 'stranded' || !cat.stranded) continue
      if (cat.stranded.targetSlotId === null) {
        const restSlot = this.findRestSeat()
        if (!restSlot) continue
        restSlot.slot.reservedByCatId = cat.id
        cat.stranded.targetNodeId = restSlot.node.id
        cat.stranded.targetSlotId = restSlot.slot.id
      }
      const targetSlotId = cat.stranded.targetSlotId
      if (this.nodes.get(cat.nodeId)?.blocked || this.nodes.get(cat.stranded.targetNodeId)?.blocked) continue
      if (this.flightUnlocked) {
        cat.status = 'travelling'
        cat.travel = this.flightTravel(cat.nodeId, cat.stranded.targetNodeId, targetSlotId, cat.stranded.sourceNodeId, null)
        cat.stranded = null
        continue
      }
      const path = this.findPath(cat.nodeId, cat.stranded.targetNodeId)
      if (!path?.length) continue
      cat.status = 'travelling'
      cat.travel = {
        kind: 'road',
        targetNodeId: cat.stranded.targetNodeId,
        targetSlotId,
        sourceNodeId: cat.stranded.sourceNodeId,
        leg: path[0],
        legProgress: 0,
      }
      cat.stranded = null
    }
  }

  private returnTiredCat(cat: Cat) {
    const restSlot = this.findRestSeat()
    if (restSlot) this.startTravel(cat, restSlot.node.id, restSlot.slot.id)
  }

  private returnRecoveredCatsToAssignedSlots() {
    for (const cat of this.cats.values()) {
      if (cat.status !== 'idle' || this.nodes.get(cat.nodeId)?.type !== 'rest' || cat.vigor < GAME_BALANCE.cats.maxVigor - EPSILON) continue
      const assignment = this.findWorkAssignment(cat.id)
      if (!assignment || assignment.slot.catId || assignment.slot.reservedByCatId) continue
      this.startTravel(cat, assignment.node.id, assignment.slot.id)
    }
  }

  private findWorkAssignment(catId: string): { node: SimNode; slot: WorkSlot } | null {
    for (const node of this.nodes.values()) {
      if (node.type === 'rest' || node.type === 'hub') continue
      const slot = node.slots.find((candidate) => candidate.assignedCatId === catId)
      if (slot) return { node, slot }
    }
    return null
  }

  private findRestSeat(): { node: SimNode; slot: WorkSlot } | null {
    for (const node of this.nodes.values()) {
      if (node.type !== 'rest' || node.blocked) continue
      const slot = node.slots.find((candidate) => !candidate.catId && !candidate.reservedByCatId)
      if (slot) return { node, slot }
    }
    return null
  }

  private findNearestRestSeat(position: Point): { node: SimNode; slot: WorkSlot } | null {
    const candidates = [...this.nodes.values()].flatMap((node) => {
      if (node.type !== 'rest' || node.blocked) return []
      const nodePosition = node.position ?? { x: 0, y: 0 }
      return node.slots
        .filter((slot) => !slot.catId && !slot.reservedByCatId)
        .map((slot) => ({ node, slot, distance: Math.hypot(nodePosition.x - position.x, nodePosition.y - position.y) }))
    })
    candidates.sort((first, second) => first.distance - second.distance || first.node.id.localeCompare(second.node.id) || first.slot.id.localeCompare(second.slot.id))
    return candidates[0] ?? null
  }

  private seatWaitingCats() {
    for (const cat of this.cats.values()) {
      if (cat.status !== 'idle' || this.nodes.get(cat.nodeId)?.type !== 'rest' || cat.slotId) continue
      const restSeat = this.findRestSeat()
      if (!restSeat) break
      restSeat.slot.catId = cat.id
      cat.nodeId = restSeat.node.id
      cat.slotId = restSeat.slot.id
    }
  }

  private clearWorkAssignmentForCat(catId: string) {
    for (const node of this.nodes.values()) {
      if (node.type === 'rest' || node.type === 'hub') continue
      for (const slot of node.slots) if (slot.assignedCatId === catId) slot.assignedCatId = null
    }
  }

  private releaseCatReservations(catId: string) {
    for (const node of this.nodes.values()) {
      for (const slot of node.slots) if (slot.reservedByCatId === catId) slot.reservedByCatId = null
    }
  }

  private releaseCatOccupancyAndReservations(catId: string) {
    for (const node of this.nodes.values()) {
      for (const slot of node.slots) {
        if (slot.catId === catId) slot.catId = null
        if (slot.reservedByCatId === catId) slot.reservedByCatId = null
      }
    }
  }

  private catPosition(cat: Cat): Point {
    if (cat.travel) {
      const fromId = cat.travel.kind === 'road' ? cat.travel.leg.fromNodeId : cat.travel.fromNodeId
      const toId = cat.travel.kind === 'road' ? cat.travel.leg.toNodeId : cat.travel.targetNodeId
      const progress = cat.travel.kind === 'road' ? cat.travel.legProgress : cat.travel.flightProgress
      const from = this.nodes.get(fromId)?.position ?? { x: 0, y: 0 }
      const to = this.nodes.get(toId)?.position ?? { x: 0, y: 0 }
      return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }
    }
    return { ...(this.nodes.get(cat.nodeId)?.position ?? { x: 0, y: 0 }) }
  }

  private linksForNode(nodeId: string) {
    return [...this.workerLinks.values()].filter((link) => link.nodeAId === nodeId || link.nodeBId === nodeId)
  }

  private linksForPort(nodeId: string, port: RoadPort) {
    return this.linksForNode(nodeId).filter((link) => link.nodeAId === nodeId ? link.nodeAPort === port : link.nodeBPort === port)
  }

  private upkeepBreakdown(): UpkeepBreakdown {
    const breakdown: UpkeepBreakdown = { rest: 0, research: 0, server: 0, hub: 0, terminal: 0, cats: 0 }
    for (const node of this.nodes.values()) breakdown[node.type] += GAME_BALANCE.nodes[node.type].upkeepPerMinute
    breakdown.cats = this.cats.size * GAME_BALANCE.economy.catUpkeepPerMinute
    return breakdown
  }

  private totalUpkeep(breakdown: UpkeepBreakdown) {
    return Object.values(breakdown).reduce((total, value) => total + value, 0)
  }

  private upkeepPerMinute() {
    return this.totalUpkeep(this.upkeepBreakdown())
  }

  private restoreState(state: SimulationStateV5) {
    if (!state.nodes.some((node) => node.id === REST_ID && node.type === 'rest')) return false
    const nodeIds = new Set<string>()
    const slotIds = new Set<string>()
    for (const node of state.nodes) {
      if (nodeIds.has(node.id)) return false
      nodeIds.add(node.id)
      for (const slot of node.slots) {
        if (slotIds.has(slot.id)) return false
        slotIds.add(slot.id)
      }
      this.nodes.set(node.id, copyNode(node))
    }
    const catIds = new Set<string>()
    for (const cat of state.cats) {
      if (catIds.has(cat.id) || !nodeIds.has(cat.nodeId) || cat.vigor < 0 || cat.vigor > GAME_BALANCE.cats.maxVigor + EPSILON) return false
      catIds.add(cat.id)
      this.cats.set(cat.id, copyCat(cat))
    }
    if (!catIds.has('cat-1')) return false
    const workerIds = new Set<string>()
    const usedRoadPorts = new Set<string>()
    for (const link of state.workerLinks) {
      if (workerIds.has(link.id) || !nodeIds.has(link.nodeAId) || !nodeIds.has(link.nodeBId) || link.nodeAId === link.nodeBId) return false
      const nodeA = this.nodes.get(link.nodeAId)!
      const nodeB = this.nodes.get(link.nodeBId)!
      if (!roadPorts(nodeA.type).includes(link.nodeAPort) || !roadPorts(nodeB.type).includes(link.nodeBPort)) return false
      const portA = `${link.nodeAId}:${link.nodeAPort}`
      const portB = `${link.nodeBId}:${link.nodeBPort}`
      if (usedRoadPorts.has(portA) || usedRoadPorts.has(portB)) return false
      usedRoadPorts.add(portA)
      usedRoadPorts.add(portB)
      workerIds.add(link.id)
      this.workerLinks.set(link.id, { ...link })
    }
    const connectionIds = new Set<string>()
    for (const connection of state.connections) {
      const source = this.nodes.get(connection.sourceId)
      const target = this.nodes.get(connection.targetId)
      const compatible = source && target && connection.sourceId !== connection.targetId && (
        (source.type === 'research' && target.type === 'server')
        || (source.type === 'server' && target.type === 'server')
        || (source.type === 'server' && target.type === 'terminal'))
      if (!compatible || connectionIds.has(connection.id)) return false
      if (target.type === 'terminal' && [...this.connections.values()].some((candidate) => candidate.targetId === target.id)) return false
      if (source.type === 'server' && target.type === 'server' && this.hasDataPath(target.id, source.id)) return false
      connectionIds.add(connection.id)
      this.connections.set(connection.id, { ...connection })
    }
    for (const node of this.nodes.values()) {
      for (const slot of node.slots) {
        if ((slot.catId && !catIds.has(slot.catId)) || (slot.reservedByCatId && !catIds.has(slot.reservedByCatId)) || (slot.assignedCatId && !catIds.has(slot.assignedCatId))) return false
        if (slot.catId) {
          const cat = this.cats.get(slot.catId)!
          if (cat.nodeId !== node.id || cat.slotId !== slot.id) return false
        }
      }
    }
    for (const cat of this.cats.values()) {
      if (cat.slotId && !this.nodes.get(cat.nodeId)?.slots.some((slot) => slot.id === cat.slotId && slot.catId === cat.id)) return false
      if (cat.travel) {
        const target = this.nodes.get(cat.travel.targetNodeId)
        if (!target?.slots.some((slot) => slot.id === cat.travel?.targetSlotId && slot.reservedByCatId === cat.id)) return false
        if (cat.travel.kind === 'road' && !workerIds.has(cat.travel.leg.linkId)) return false
      }
      if (cat.stranded) {
        const target = this.nodes.get(cat.stranded.targetNodeId)
        if (!target) return false
        if (cat.stranded.targetSlotId === null) {
          if (cat.status !== 'stranded' || cat.stranded.targetNodeId !== REST_ID || cat.slotId || cat.travel) return false
        } else if (!target.slots.some((slot) => slot.id === cat.stranded?.targetSlotId && slot.reservedByCatId === cat.id)) return false
      }
    }
    const highestCatId = Math.max(...[...catIds].map((id) => Number(id.match(/^cat-(\d+)$/)?.[1] ?? Number.NaN)))
    if (!Number.isFinite(highestCatId) || state.catCounter < highestCatId) return false
    this.nodeCounter = state.nodeCounter
    this.catCounter = state.catCounter
    this.flightUnlocked = state.flightUnlocked
    this.scienceProgress = state.scienceProgress
    if (this.flightUnlocked !== (this.scienceProgress >= GAME_BALANCE.science.flightUnlockProgress)) return false
    this.credits = state.economy.credits
    this.totalEarned = state.economy.totalEarned
    this.totalSpent = state.economy.totalSpent
    this.totalDataSold = state.economy.totalDataSold
    const terminalSales = [...this.nodes.values()].reduce((total, node) => total + node.dataSold, 0)
    if (this.totalDataSold + EPSILON < terminalSales) return false
    this.goalAchieved = state.goal.achieved
    this.goalAcknowledged = state.goal.acknowledged
    this.profitableSeconds = state.goal.profitableSeconds
    this.peakNetIncomePerMinute = state.goal.peakNetIncomePerMinute
    if (this.goalAcknowledged && !this.goalAchieved) return false
    if (this.goalAchieved && (!this.flightUnlocked || this.peakNetIncomePerMinute + EPSILON < GAME_BALANCE.objective.requiredPeakNetIncomePerMinute || this.profitableSeconds + EPSILON < GAME_BALANCE.objective.requiredProfitableSeconds)) return false
    this.lastRevenuePerMinute = 0
    return true
  }

  private spend(amount: number) {
    this.credits -= amount
    this.totalSpent += amount
  }

  private updateGoalProgress(deltaSeconds: number) {
    const netIncomePerMinute = this.lastRevenuePerMinute - this.upkeepPerMinute()
    this.peakNetIncomePerMinute = Math.max(this.peakNetIncomePerMinute, netIncomePerMinute)
    if (this.goalAchieved) return
    const researchNodes = [...this.nodes.values()].filter((node) => node.type === 'research')
    const hasFullyStaffedResearch = researchNodes.length >= GAME_BALANCE.objective.requiredResearchNodes
      && researchNodes.every((node) => !node.blocked && node.slots.every((slot) => slot.assignedCatId !== null))
    const hasRequiredInfrastructure = hasFullyStaffedResearch && this.flightUnlocked
    const timerComplete = this.profitableSeconds + EPSILON >= GAME_BALANCE.objective.requiredProfitableSeconds
    if (!timerComplete) {
      if (!hasRequiredInfrastructure || netIncomePerMinute <= EPSILON) this.profitableSeconds = 0
      else this.profitableSeconds = Math.min(GAME_BALANCE.objective.requiredProfitableSeconds, this.profitableSeconds + deltaSeconds)
    }
    if (!hasRequiredInfrastructure || this.peakNetIncomePerMinute + EPSILON < GAME_BALANCE.objective.requiredPeakNetIncomePerMinute || this.profitableSeconds + EPSILON < GAME_BALANCE.objective.requiredProfitableSeconds) return
    this.profitableSeconds = GAME_BALANCE.objective.requiredProfitableSeconds
    this.goalAchieved = true
  }

  private sourceData(node: SimNode) {
    return node.type === 'research' ? node.dataBuffer : node.type === 'server' ? node.dataStored : 0
  }

  private takeSourceData(node: SimNode, amount: number) {
    if (node.type === 'research') node.dataBuffer = Math.max(0, node.dataBuffer - amount)
    else if (node.type === 'server') node.dataStored = Math.max(0, node.dataStored - amount)
  }

  private pullData(targetId: string, capacity: number, deltaSeconds: number) {
    const incoming = [...this.connections.values()]
      .filter((connection) => connection.targetId === targetId)
      .sort((first, second) => first.id.localeCompare(second.id))
    let remaining = capacity
    let total = 0
    while (remaining > EPSILON) {
      const active = incoming.flatMap((connection) => {
        const source = this.nodes.get(connection.sourceId)
        return source && !source.blocked && this.sourceData(source) > EPSILON ? [{ connection, source }] : []
      })
      if (!active.length) break
      const share = remaining / active.length
      let moved = 0
      for (const { source } of active) {
        const amount = Math.min(this.sourceData(source), share)
        this.takeSourceData(source, amount)
        source.outputRate += amount / deltaSeconds
        remaining -= amount
        total += amount
        moved += amount
      }
      if (moved <= EPSILON) break
    }
    return total
  }

  private dataOrderedServers() {
    const servers = [...this.nodes.values()].filter((node) => node.type === 'server')
    const indegrees = new Map(servers.map((server) => [server.id, 0]))
    for (const connection of this.connections.values()) {
      if (indegrees.has(connection.sourceId) && indegrees.has(connection.targetId)) indegrees.set(connection.targetId, indegrees.get(connection.targetId)! + 1)
    }
    const ready = servers.filter((server) => indegrees.get(server.id) === 0).sort((a, b) => a.id.localeCompare(b.id))
    const ordered: SimNode[] = []
    while (ready.length) {
      const current = ready.shift()!
      ordered.push(current)
      for (const connection of this.connections.values()) {
        if (connection.sourceId !== current.id || !indegrees.has(connection.targetId)) continue
        indegrees.set(connection.targetId, indegrees.get(connection.targetId)! - 1)
        if (indegrees.get(connection.targetId) === 0) {
          ready.push(this.nodes.get(connection.targetId)!)
          ready.sort((a, b) => a.id.localeCompare(b.id))
        }
      }
    }
    return [...ordered, ...servers.filter((server) => !ordered.includes(server)).sort((a, b) => a.id.localeCompare(b.id))]
  }

  private hasDataPath(startId: string, targetId: string) {
    const pending = [startId]
    const visited = new Set<string>()
    while (pending.length) {
      const current = pending.shift()!
      if (current === targetId) return true
      if (visited.has(current)) continue
      visited.add(current)
      for (const connection of this.connections.values()) if (connection.sourceId === current) pending.push(connection.targetId)
    }
    return false
  }

  private findPath(startId: string, targetId: string): TravelLeg[] | null {
    if (this.nodes.get(startId)?.blocked || this.nodes.get(targetId)?.blocked) return null
    const distances = new Map<string, number>([...this.nodes.keys()].map((id) => [id, Number.POSITIVE_INFINITY]))
    const paths = new Map<string, TravelLeg[]>()
    const visited = new Set<string>()
    distances.set(startId, 0)
    paths.set(startId, [])
    while (visited.size < this.nodes.size) {
      const current = [...this.nodes.keys()].filter((id) => !visited.has(id)).sort((a, b) => (distances.get(a)! - distances.get(b)!) || a.localeCompare(b))[0]
      if (!current || !Number.isFinite(distances.get(current)!)) break
      if (current === targetId) return paths.get(current) ?? []
      visited.add(current)
      const adjacent = this.linksForNode(current).sort((a, b) => a.id.localeCompare(b.id))
      for (const link of adjacent) {
        const next = link.nodeAId === current ? link.nodeBId : link.nodeAId
        if (this.nodes.get(next)?.blocked) continue
        if (visited.has(next)) continue
        const candidateDistance = distances.get(current)! + link.travelSeconds
        const candidatePath = [...(paths.get(current) ?? []), { linkId: link.id, fromNodeId: current, toNodeId: next }]
        const oldPath = paths.get(next) ?? []
        const candidateKey = candidatePath.map((leg) => leg.linkId).join('|')
        const oldKey = oldPath.map((leg) => leg.linkId).join('|')
        if (candidateDistance < distances.get(next)! - EPSILON || (Math.abs(candidateDistance - distances.get(next)!) < EPSILON && candidateKey < oldKey)) {
          distances.set(next, candidateDistance)
          paths.set(next, candidatePath)
        }
      }
    }
    return null
  }

  private flightTravel(fromNodeId: string, targetNodeId: string, targetSlotId: string, sourceNodeId: string, fromSlotId: string | null) {
    return {
      kind: 'flight' as const,
      fromNodeId,
      fromSlotId,
      targetNodeId,
      targetSlotId,
      sourceNodeId,
      flightDurationSeconds: this.flightDuration(fromNodeId, targetNodeId),
      flightProgress: 0,
    }
  }

  private flightDuration(fromNodeId: string, targetNodeId: string) {
    const from = this.nodes.get(fromNodeId)?.position
    const target = this.nodes.get(targetNodeId)?.position
    const minimumFlightSeconds = GAME_BALANCE.transport.minimumRoadTravelSeconds / GAME_BALANCE.transport.flightSpeedMultiplier
    if (!from || !target) return minimumFlightSeconds
    return Math.max(minimumFlightSeconds, Math.hypot(target.x - from.x, target.y - from.y) / (GAME_BALANCE.transport.roadSpeedPixelsPerSecond * GAME_BALANCE.transport.flightSpeedMultiplier))
  }

  private unlockFlightIfReady() {
    if (this.flightUnlocked || this.scienceProgress < GAME_BALANCE.science.flightUnlockProgress) return
    this.flightUnlocked = true
    this.resumeStrandedCats()
    this.returnRecoveredCatsToAssignedSlots()
  }

  private advanceCat(cat: Cat, deltaSeconds: number): number {
    if (cat.status !== 'travelling' || !cat.travel || deltaSeconds <= 0) return cat.status === 'idle' ? deltaSeconds : 0
    let remainingTime = deltaSeconds
    while (cat.travel && remainingTime > EPSILON) {
      if (cat.travel.kind === 'flight') {
        const travel = cat.travel
        if (this.nodes.get(travel.fromNodeId)?.blocked || this.nodes.get(travel.targetNodeId)?.blocked) {
          cat.status = 'stranded'
          cat.stranded = { targetNodeId: travel.targetNodeId, targetSlotId: travel.targetSlotId, sourceNodeId: travel.sourceNodeId }
          cat.travel = null
          return 0
        }
        const timeToFinish = travel.flightDurationSeconds * (1 - travel.flightProgress)
        if (remainingTime + EPSILON < timeToFinish) {
          travel.flightProgress += remainingTime / travel.flightDurationSeconds
          return 0
        }
        remainingTime -= timeToFinish
        cat.nodeId = travel.targetNodeId
        const targetSlot = this.nodes.get(travel.targetNodeId)?.slots.find((slot) => slot.id === travel.targetSlotId)
        if (!targetSlot || targetSlot.reservedByCatId !== cat.id) return 0
        targetSlot.reservedByCatId = null
        targetSlot.catId = cat.id
        cat.slotId = targetSlot.id
        cat.status = 'idle'
        cat.travel = null
        return remainingTime
      }
      const leg = cat.travel.leg
      const link = this.workerLinks.get(leg.linkId)
      if (!link || this.nodes.get(leg.fromNodeId)?.blocked || this.nodes.get(leg.toNodeId)?.blocked) {
        cat.status = 'stranded'
        cat.stranded = { targetNodeId: cat.travel.targetNodeId, targetSlotId: cat.travel.targetSlotId, sourceNodeId: cat.travel.sourceNodeId }
        cat.travel = null
        return 0
      }
      const timeToFinish = link.travelSeconds * (1 - cat.travel.legProgress)
      if (remainingTime + EPSILON < timeToFinish) {
        cat.travel.legProgress += remainingTime / link.travelSeconds
        return 0
      }
      remainingTime -= timeToFinish
      cat.nodeId = leg.toNodeId
      cat.travel.legProgress = 0
      if (cat.nodeId !== cat.travel.targetNodeId) {
        if (!this.continueTravel(cat)) return 0
        continue
      }
      const targetSlot = this.nodes.get(cat.travel.targetNodeId)?.slots.find((slot) => slot.id === cat.travel?.targetSlotId)
      if (!targetSlot || targetSlot.reservedByCatId !== cat.id) return 0
      targetSlot.reservedByCatId = null
      targetSlot.catId = cat.id
      cat.slotId = targetSlot.id
      cat.status = 'idle'
      cat.travel = null
      return remainingTime
    }
    return 0
  }
}

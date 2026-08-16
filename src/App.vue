<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ConnectionMode, MarkerType, VueFlow, type Connection as FlowConnection, type Edge, type EdgeMouseEvent, type Node, type NodeDragEvent, type NodeMouseEvent } from '@vue-flow/core'
import { GAME_BALANCE, Simulation, type Cat, type CommandResult, type NodeType, type RoadPort, type SimNode, type UpkeepBreakdown } from './core'
import GameNode from './components/GameNode.vue'
import CatFlightEdge from './components/CatFlightEdge.vue'
import WorkerTransitEdge from './components/WorkerTransitEdge.vue'
import { formatGameInteger, formatGameNumber, formatVigor } from './formatGameNumber'

type Point = { x: number; y: number }
type Size = { width: number; height: number }
type FlowCoordinateApi = { screenToFlowCoordinate: (position: Point) => Point }
type SimulationSpeed = 0 | 1 | 5 | 10 | 100
type SpeedOption = { value: SimulationSpeed; label: string; shortcut?: string }

const SAVE_KEY = 'catmand-save-v5'
const SAVE_WARNING_KEY = 'catmand-save-warning-acknowledged'
const appVersion = __APP_VERSION__
let initialSaveError = ''
let invalidStoredSave = ''
let simulation = new Simulation()
if (typeof window !== 'undefined') {
  const stored = window.localStorage.getItem(SAVE_KEY)
  if (stored) {
    try {
      const restored = Simulation.fromSave(JSON.parse(stored))
      if (restored.ok) simulation = restored.value
      else {
        initialSaveError = restored.reason
        invalidStoredSave = stored
      }
    } catch {
      initialSaveError = 'Локальное сохранение повреждено. Экспортируйте его или начните заново.'
      invalidStoredSave = stored
    }
  }
}
const nodeTypes = { game: markRaw(GameNode) }
const edgeTypes = { workerTransit: markRaw(WorkerTransitEdge), flightTransit: markRaw(CatFlightEdge) }
const snapshot = ref(simulation.snapshot())
const showGoalModal = ref(snapshot.value.goal.achieved && !snapshot.value.goal.acknowledged)
const goalContinueButton = ref<HTMLButtonElement | null>(null)
const selectedCatId = ref<string | null>(null)
const selectedSlot = ref<{ nodeId: string; slotId: string } | null>(null)
const selectedConnection = ref<{ id: string; kind: 'data' | 'worker' } | null>(null)
const selectedModuleId = ref<string | null>(null)
const status = ref(initialSaveError || 'Создайте лабораторию и назначьте кота на исследование.')
const saveError = ref(initialSaveError)
const showEarlyWarning = ref(typeof window !== 'undefined' && window.localStorage.getItem(SAVE_WARNING_KEY) !== '1')
const simulationSpeed = ref<SimulationSpeed>(showGoalModal.value ? 0 : 1)
const lastRunningSpeed = ref<Exclude<SimulationSpeed, 0>>(1)
const diagnosticSpeedUnlocked = ref(false)
const normalSpeedOptions: SpeedOption[] = [
  { value: 0, label: 'Пауза', shortcut: 'Space' },
  { value: 1, label: `×${formatGameInteger(1)}`, shortcut: '1' },
  { value: 5, label: `×${formatGameInteger(5)}`, shortcut: '2' },
  { value: 10, label: `×${formatGameInteger(10)}`, shortcut: '3' },
]
const speedOptions = computed(() => diagnosticSpeedUnlocked.value ? [...normalSpeedOptions, { value: 100 as const, label: `×${formatGameInteger(100)}` }] : normalSpeedOptions)
const positions = ref<Record<string, Point>>(Object.fromEntries(simulation.snapshot().nodes.map((node) => [node.id, node.position ?? { x: 0, y: 0 }])))
const graphFrame = ref<HTMLElement | null>(null)
const flowCoordinateApi = shallowRef<FlowCoordinateApi | null>(null)

const catIndex = computed<Record<string, Cat>>(() => Object.fromEntries(snapshot.value.cats.map((cat) => [cat.id, cat])))
const assignedCatIds = computed(() => new Set(snapshot.value.nodes.flatMap((node) => node.slots.flatMap((slot) => slot.assignedCatId ? [slot.assignedCatId] : []))))
const unassignedCats = computed(() => snapshot.value.cats.filter((cat) => !assignedCatIds.value.has(cat.id)))
const unassignedCatIds = computed(() => unassignedCats.value.map((cat) => cat.id))
const unreachableCatIds = computed(() => snapshot.value.nodes.flatMap((node) => node.type === 'rest' || node.type === 'hub' ? [] : node.slots.flatMap((slot) => {
  const cat = slot.assignedCatId ? catIndex.value[slot.assignedCatId] : undefined
  return !slot.catId
    && !slot.reservedByCatId
    && cat?.status === 'idle'
    && cat.vigor >= GAME_BALANCE.cats.maxVigor
    && cat.nodeId !== node.id
    ? [cat.id]
    : []
})))
const canHireCat = computed(() => snapshot.value.economy.credits >= GAME_BALANCE.economy.hireCatCost)
const showRestConstruction = computed(() => snapshot.value.cats.length > GAME_BALANCE.nodes.rest.slots)
const showServerConstruction = computed(() => snapshot.value.nodes.some((node) => node.type === 'research'))
const showTerminalConstruction = computed(() => snapshot.value.nodes.some((node) => node.type === 'server'))
const showHubConstruction = computed(() => !snapshot.value.flightUnlocked && snapshot.value.nodes.length > 2)
const totalScience = computed(() => snapshot.value.scienceProgress)
const totalData = computed(() => snapshot.value.nodes.reduce((total, node) => total + node.dataBuffer + node.dataStored, 0))
const netIncomePerMinute = computed(() => snapshot.value.economy.revenuePerMinute - snapshot.value.economy.upkeepPerMinute)
const scienceGoalComplete = computed(() => snapshot.value.flightUnlocked)
const flightResearchProgress = computed(() => Math.min(totalScience.value / GAME_BALANCE.science.flightUnlockProgress * 100, 100))
const researchNodes = computed(() => snapshot.value.nodes.filter((node) => node.type === 'research'))
const fullyStaffedResearchCount = computed(() => researchNodes.value.filter((node) => !node.blocked && node.slots.every((slot) => slot.assignedCatId !== null)).length)
const requiredResearchDisplayCount = computed(() => Math.max(researchNodes.value.length, GAME_BALANCE.objective.requiredResearchNodes))
const researchGoalComplete = computed(() => researchNodes.value.length >= GAME_BALANCE.objective.requiredResearchNodes && fullyStaffedResearchCount.value === researchNodes.value.length)
const profitGoalComplete = computed(() => snapshot.value.goal.achieved || snapshot.value.goal.profitableSeconds >= GAME_BALANCE.objective.requiredProfitableSeconds)
const profitTimerProgress = computed(() => Math.min(snapshot.value.goal.profitableSeconds / GAME_BALANCE.objective.requiredProfitableSeconds * 100, 100))
const selectedCat = computed(() => selectedCatId.value ? catIndex.value[selectedCatId.value] : undefined)
const canDismissSelectedCat = computed(() => Boolean(selectedCat.value && selectedCat.value.id !== 'cat-1'))

type ExpenseKey = keyof UpkeepBreakdown
const expenseDefinitions: Array<{ key: ExpenseKey; label: string }> = [
  { key: 'rest', label: 'Комнаты отдыха' },
  { key: 'research', label: 'Исследования' },
  { key: 'server', label: 'Серверы' },
  { key: 'hub', label: 'Дорожные хабы' },
  { key: 'terminal', label: 'Торговые терминалы' },
  { key: 'cats', label: 'Коты' },
]
const expenseSegments = computed(() => expenseDefinitions.flatMap(({ key, label }) => {
  const value = snapshot.value.economy.upkeepBreakdown[key]
  if (value <= 0) return []
  const total = snapshot.value.economy.upkeepPerMinute
  return [{ key, label, value, percentage: total > 0 ? value / total * 100 : 0 }]
}))
const expenseAriaLabel = computed(() => `Расходы ${formatGameNumber(snapshot.value.economy.upkeepPerMinute)} в минуту. ${expenseSegments.value.map((segment) => `${segment.label}: ${formatGameNumber(segment.value)}`).join('. ')}`)

function formatSignedGameNumber(value: number) {
  const normalized = Math.abs(value) < 0.000001 ? 0 : value
  return `${normalized > 0 ? '+' : ''}${formatGameNumber(normalized)}`
}

function formatGoalDuration(seconds: number) {
  const clampedSeconds = Math.floor(Math.min(Math.max(seconds, 0), GAME_BALANCE.objective.requiredProfitableSeconds))
  const minutes = Math.floor(clampedSeconds / 60)
  return `${minutes}:${String(clampedSeconds % 60).padStart(2, '0')}`
}

function nodePosition(node: SimNode): Point {
  if (positions.value[node.id]) return positions.value[node.id]
  return node.position && (node.position.x || node.position.y) ? node.position : defaultNodePosition(node.type)
}

function unassignedCatState(cat: Cat) {
  if (cat.status === 'stranded') return 'путь недоступен'
  if (cat.status === 'travelling') return 'в пути'
  const currentNode = snapshot.value.nodes.find((node) => node.id === cat.nodeId)
  if (currentNode?.type !== 'rest') return 'без работы'
  if (!cat.slotId) return 'ждёт кресло'
  return cat.vigor >= GAME_BALANCE.cats.maxVigor ? 'готов к работе' : 'восстанавливается'
}

function defaultNodePosition(type: NodeType): Point {
  const count = snapshot.value.nodes.filter((node) => node.type === type).length
  const offset = count * 55
  if (type === 'rest') return { x: 80 + offset, y: 270 + offset }
  if (type === 'research') return { x: 440 + offset, y: 150 + offset }
  if (type === 'server') return { x: 805 + offset, y: 300 + offset }
  if (type === 'terminal') return { x: 440 + offset, y: 450 + offset }
  return { x: 620 + offset, y: 500 + offset }
}

function nodeSize(type: NodeType): Size {
  return type === 'hub' ? { width: 76, height: 76 } : { width: 286, height: 220 }
}

function handleFlowInit(api: FlowCoordinateApi) {
  flowCoordinateApi.value = api
}

function centeredNodePosition(type: NodeType): Point {
  const bounds = graphFrame.value?.getBoundingClientRect()
  if (!bounds || !flowCoordinateApi.value) return defaultNodePosition(type)
  const center = flowCoordinateApi.value.screenToFlowCoordinate({
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  })
  const size = nodeSize(type)
  const origin = { x: center.x - size.width / 2, y: center.y - size.height / 2 }
  const existingNodes = snapshot.value.nodes
  const fits = (candidate: Point) => existingNodes.every((node) => !overlaps(candidate, size, nodePosition(node), nodeSize(node.type)))
  if (fits(origin)) return origin

  const stepX = 318
  const stepY = 252
  for (let ring = 1; ring <= 12; ring += 1) {
    const offsets: Point[] = [
      { x: ring, y: 0 }, { x: -ring, y: 0 }, { x: 0, y: ring }, { x: 0, y: -ring },
    ]
    for (let offset = 1; offset <= ring; offset += 1) {
      offsets.push(
        { x: ring, y: offset }, { x: ring, y: -offset }, { x: -ring, y: offset }, { x: -ring, y: -offset },
        { x: offset, y: ring }, { x: -offset, y: ring }, { x: offset, y: -ring }, { x: -offset, y: -ring },
      )
    }
    for (const offset of offsets) {
      const candidate = { x: origin.x + offset.x * stepX, y: origin.y + offset.y * stepY }
      if (fits(candidate)) return candidate
    }
  }
  return origin
}

function overlaps(first: Point, firstSize: Size, second: Point, secondSize: Size) {
  return first.x < second.x + secondSize.width
    && first.x + firstSize.width > second.x
    && first.y < second.y + secondSize.height
    && first.y + firstSize.height > second.y
}

function overlappingNodeIds() {
  const blocked = new Set<string>()
  for (let firstIndex = 0; firstIndex < snapshot.value.nodes.length; firstIndex += 1) {
    const first = snapshot.value.nodes[firstIndex]
    for (const second of snapshot.value.nodes.slice(firstIndex + 1)) {
      if (!overlaps(nodePosition(first), nodeSize(first.type), nodePosition(second), nodeSize(second.type))) continue
      blocked.add(first.id)
      blocked.add(second.id)
    }
  }
  return blocked
}

function syncBlockedNodes() {
  const blockedIds = overlappingNodeIds()
  for (const node of snapshot.value.nodes) simulation.setNodeBlocked(node.id, blockedIds.has(node.id))
  sync()
}

const flowNodes = computed<Node[]>(() => {
  const moduleNodes: Node[] = snapshot.value.nodes.map((node) => ({
    id: node.id,
    type: 'game',
    position: nodePosition(node),
    style: { width: `${nodeSize(node.type).width}px` },
    selected: selectedModuleId.value === node.id,
    data: {
      node,
      blocked: node.blocked,
      cats: catIndex.value,
      unreachableCatIds: unreachableCatIds.value,
      unassignedCatIds: unassignedCatIds.value,
      restWaitingCats: node.type === 'rest' ? snapshot.value.cats.filter((cat) => cat.nodeId === node.id && !cat.slotId && cat.status === 'idle') : [],
      strandedCats: snapshot.value.cats.filter((cat) => cat.nodeId === node.id && cat.status === 'stranded'),
      selectedCatId: selectedCatId.value,
      selectedSlotId: selectedSlot.value?.slotId ?? null,
      onCatClick: selectCat,
      onSlotClick: handleSlotClick,
    },
  }))
  return moduleNodes
})

const flowEdges = computed<Edge[]>(() => {
  const dataEdges: Edge[] = snapshot.value.connections.map((connection) => ({
    id: connection.id, source: connection.sourceId, target: connection.targetId, sourceHandle: 'data-out', targetHandle: 'data-in',
    type: 'smoothstep', animated: true, markerEnd: MarkerType.ArrowClosed, class: 'science-edge', selected: selectedConnection.value?.id === connection.id, data: { kind: 'data' },
  }))
  const workerEdges: Edge[] = snapshot.value.workerLinks.map((link) => ({
    id: link.id, source: link.nodeAId, target: link.nodeBId, sourceHandle: roadHandle(link.nodeAPort), targetHandle: roadHandle(link.nodeBPort),
    type: 'workerTransit', animated: false, markerStart: MarkerType.ArrowClosed, markerEnd: MarkerType.ArrowClosed, class: 'worker-edge',
    selected: selectedConnection.value?.id === link.id, label: `${formatGameNumber(link.travelSeconds)}с`,
    data: { kind: 'worker', cats: snapshot.value.cats.filter((cat) => cat.travel?.kind === 'road' && cat.travel.leg.linkId === link.id) },
  }))
  const flightEdges: Edge[] = snapshot.value.cats.flatMap((cat) => {
    const travel = cat.travel
    if (travel?.kind !== 'flight') return []
    const fromNode = snapshot.value.nodes.find((node) => node.id === travel.fromNodeId)
    const targetNode = snapshot.value.nodes.find((node) => node.id === travel.targetNodeId)
    if (!fromNode || !targetNode) return []
    return [{
      id: `flight-${cat.id}`,
      source: fromNode.id,
      target: targetNode.id,
      type: 'flightTransit',
      class: 'flight-edge',
      zIndex: 1000,
      selectable: false,
      focusable: false,
      data: {
        kind: 'flight',
        cat,
        origin: flightSlotPoint(fromNode, travel.fromSlotId),
        targetPoint: flightSlotPoint(targetNode, travel.targetSlotId),
      },
    }]
  })
  return [...dataEdges, ...workerEdges, ...(simulationSpeed.value === 1 ? flightEdges : [])]
})

const renderedEdges = ref<Edge[]>([])
watch(flowEdges, (edges) => { renderedEdges.value = edges }, { immediate: true })

function roadHandle(port: RoadPort) {
  return port === 'road' ? 'road' : `hub-${port}`
}

function roadPort(handle: string | null | undefined): RoadPort | null {
  if (handle === 'road') return 'road'
  const match = handle?.match(/^hub-(north|east|south|west)$/)
  return match?.[1] as RoadPort | undefined ?? null
}

function workerTravelSeconds(firstId: string, secondId: string) {
  const first = nodePosition(snapshot.value.nodes.find((node) => node.id === firstId)!)
  const second = nodePosition(snapshot.value.nodes.find((node) => node.id === secondId)!)
  return Math.max(GAME_BALANCE.transport.minimumRoadTravelSeconds, Math.hypot(second.x - first.x, second.y - first.y) / GAME_BALANCE.transport.roadSpeedPixelsPerSecond)
}

function flightSlotPoint(node: SimNode, slotId: string | null): Point {
  const position = nodePosition(node)
  const slotIndex = slotId ? node.slots.findIndex((slot) => slot.id === slotId) : -1
  if (slotIndex < 0) return { x: position.x + nodeSize(node.type).width / 2, y: position.y + nodeSize(node.type).height / 2 }
  const columns = node.type === 'research' ? 2 : node.type === 'server' || node.type === 'terminal' ? 1 : 3
  const gridWidth = nodeSize(node.type).width - 32
  const gap = 7
  const cellWidth = (gridWidth - gap * (columns - 1)) / columns
  return {
    x: position.x + 16 + cellWidth * (slotIndex % columns + .5) + gap * (slotIndex % columns),
    y: position.y + 117,
  }
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null
let autosaveEnabled = !initialSaveError

function saveLocalNow() {
  if (!autosaveEnabled || typeof window === 'undefined') return
  window.localStorage.setItem(SAVE_KEY, JSON.stringify(simulation.exportSave()))
}

function scheduleAutosave() {
  if (!autosaveEnabled || autosaveTimer) return
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    saveLocalNow()
  }, 10_000)
}

function sync() {
  snapshot.value = simulation.snapshot()
  scheduleAutosave()
}

function report(result: CommandResult<unknown>, success: string) {
  if (result.ok) {
    status.value = success
    sync()
  } else {
    status.value = result.reason
  }
}

function createNode(type: NodeType) {
  const result = simulation.createNode(type)
  if (result.ok) {
    positions.value[result.value.id] = centeredNodePosition(type)
    simulation.setNodePosition(result.value.id, positions.value[result.value.id])
    sync()
    syncBlockedNodes()
  }
  report(result, type === 'rest' ? 'Комната отдыха развёрнута: добавлены три кресла для котов.' : type === 'research' ? 'Исследовательский модуль развёрнут.' : type === 'server' ? 'Сервер данных подключён к лаборатории.' : type === 'terminal' ? 'Торговый терминал готов продавать данные.' : 'Дорожный хаб развёрнут.')
}

function catPoint(cat: Cat): Point {
  if (cat.travel) {
    const fromId = cat.travel.kind === 'road' ? cat.travel.leg.fromNodeId : cat.travel.fromNodeId
    const toId = cat.travel.kind === 'road' ? cat.travel.leg.toNodeId : cat.travel.targetNodeId
    const progress = cat.travel.kind === 'road' ? cat.travel.legProgress : cat.travel.flightProgress
    const from = nodePosition(snapshot.value.nodes.find((node) => node.id === fromId)!)
    const to = nodePosition(snapshot.value.nodes.find((node) => node.id === toId)!)
    return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }
  }
  return nodePosition(snapshot.value.nodes.find((node) => node.id === cat.nodeId)!)
}

function rescueHubMap(hubId: string, catIds: string[]) {
  const hubs = snapshot.value.nodes.filter((node) => node.type === 'hub' && node.id !== hubId)
  return Object.fromEntries(catIds.flatMap((catId) => {
    const cat = catIndex.value[catId]
    if (!cat || !hubs.length) return []
    const point = catPoint(cat)
    const nearest = [...hubs].sort((first, second) => Math.hypot(point.x - nodePosition(first).x, point.y - nodePosition(first).y) - Math.hypot(point.x - nodePosition(second).x, point.y - nodePosition(second).y) || first.id.localeCompare(second.id))[0]
    return [[catId, nearest.id]]
  }))
}

function deleteSelectedNode() {
  const nodeId = selectedModuleId.value
  if (!nodeId) return
  const nodeName = snapshot.value.nodes.find((node) => node.id === nodeId)?.name ?? 'Модуль'
  const removesSelectedConnection = Boolean(
    selectedConnection.value
    && ([...snapshot.value.connections, ...snapshot.value.workerLinks] as Array<{ id: string; sourceId?: string; targetId?: string; nodeAId?: string; nodeBId?: string }>).some((connection) =>
      connection.id === selectedConnection.value?.id
      && (connection.sourceId === nodeId || connection.targetId === nodeId || connection.nodeAId === nodeId || connection.nodeBId === nodeId),
    ),
  )
  const selectedNode = snapshot.value.nodes.find((node) => node.id === nodeId)
  const impact = selectedNode?.type === 'hub' ? simulation.hubDeletionImpact(nodeId) : null
  const result = selectedNode?.type === 'hub' && impact?.ok
    ? simulation.deleteRoadHub(nodeId, rescueHubMap(nodeId, impact.value))
    : simulation.deleteNode(nodeId)
  if (result.ok) {
    delete positions.value[nodeId]
    if (selectedSlot.value?.nodeId === nodeId) selectedSlot.value = null
    if (removesSelectedConnection) selectedConnection.value = null
    selectedModuleId.value = null
  }
  report(result, selectedNode?.type === 'hub' ? `${nodeName} удалён; затронутые коты остановлены у ближайших хабов.` : `${nodeName} удалён вместе со всеми связанными каналами; затронутые коты эвакуированы или перенаправлены.`)
  if (result.ok) syncBlockedNodes()
}

function hireCat() {
  const result = simulation.hireCat()
  report(result, result.ok && !result.value.slotId ? `${result.value.name} ожидает свободное кресло для восстановления.` : 'Новый кот-оператор начал восстановление в комнате отдыха.')
}

function dismissSelectedCat() {
  if (!selectedCat.value) return
  const name = selectedCat.value.name
  const result = simulation.dismissCat(selectedCat.value.id)
  if (result.ok) selectedCatId.value = null
  report(result, `${name}: компенсация выплачена, кот покидает лабораторию.`)
}

function assignCatToWorkSlot(catId: string, nodeId: string, slotId: string) {
  const cat = catIndex.value[catId]
  const nodeName = snapshot.value.nodes.find((node) => node.id === nodeId)?.name ?? 'узел'
  const result = simulation.assignCat(catId, nodeId, slotId)
  const updatedCat = result.ok ? simulation.snapshot().cats.find((candidate) => candidate.id === catId) : undefined
  const activeTargetNode = updatedCat
    ? snapshot.value.nodes.find((node) => node.id === (updatedCat.travel?.targetNodeId ?? updatedCat.stranded?.targetNodeId))
    : undefined
  const success = activeTargetNode?.type === 'rest'
    ? `${cat?.name ?? 'Кот'}: место в модуле «${nodeName}» назначено; переход начнётся после отдыха.`
    : updatedCat?.status === 'stranded'
    ? `${cat?.name ?? 'Кот'}: новое место назначено, но путь к нему недоступен.`
    : updatedCat?.status === 'travelling'
    ? `${cat?.name ?? 'Кот'} направляется к модулю «${nodeName}»; место назначено.`
    : updatedCat?.nodeId === nodeId && updatedCat.slotId === slotId
      ? `${cat?.name ?? 'Кот'}: назначено новое место в этом модуле.`
    : (updatedCat?.vigor ?? 0) < GAME_BALANCE.cats.maxVigor
      ? `${cat?.name ?? 'Кот'}: место назначено; переход начнётся после полного восстановления.`
      : `${cat?.name ?? 'Кот'}: место назначено, но путь пока недоступен; слот отмечен красным.`
  report(result, success)
  return result.ok
}

function clearAllSelections() {
  selectedCatId.value = null
  selectedSlot.value = null
  selectedConnection.value = null
  selectedModuleId.value = null
}

function selectCat(catId: string) {
  const cat = catIndex.value[catId]
  selectedConnection.value = null
  selectedModuleId.value = null
  if (selectedSlot.value) {
    const target = selectedSlot.value
    if (assignCatToWorkSlot(catId, target.nodeId, target.slotId)) {
      selectedSlot.value = null
      selectedCatId.value = null
    }
    return
  }
  const wasSelected = selectedCatId.value === catId
  clearAllSelections()
  selectedCatId.value = wasSelected ? null : catId
  const currentNode = snapshot.value.nodes.find((node) => node.id === cat.nodeId)
  const activeTargetNode = snapshot.value.nodes.find((node) => node.id === (cat.travel?.targetNodeId ?? cat.stranded?.targetNodeId))
  status.value = selectedCatId.value
    ? activeTargetNode?.type === 'rest'
      ? `${cat.name}: выберите рабочее место для назначения после отдыха.`
      : activeTargetNode && activeTargetNode.type !== 'hub'
        ? `${cat.name}: выберите новую рабочую цель или нажмите текущую цель ещё раз, чтобы отменить её.`
        : currentNode?.type !== 'rest' && currentNode?.type !== 'hub' && cat.slotId
      ? `${cat.name}: выберите новое рабочее место или нажмите текущий слот ещё раз, чтобы отправить кота отдыхать.`
      : `${cat.name}: кликните по рабочему слоту.`
    : 'Выбор кота отменён.'
}

function handleSlotClick(nodeId: string, slotId: string, occupiedCatId: string | null, reservedCatId: string | null, assignedCatId: string | null) {
  selectedConnection.value = null
  selectedModuleId.value = null
  const targetNode = snapshot.value.nodes.find((node) => node.id === nodeId)
  const representedCatId = occupiedCatId ?? reservedCatId ?? assignedCatId
  if (representedCatId) {
    if (selectedCatId.value !== representedCatId) {
      selectCat(representedCatId)
      return
    }
    if (occupiedCatId && targetNode?.type !== 'rest' && targetNode?.type !== 'hub') {
      const cat = catIndex.value[representedCatId]
      const result = simulation.releaseCat(representedCatId)
      const updatedCat = result.ok ? simulation.snapshot().cats.find((candidate) => candidate.id === occupiedCatId) : undefined
      report(result, updatedCat?.status === 'travelling'
        ? `${cat?.name ?? 'Кот'}: работа завершена, начат переход к отдыху.`
        : `${cat?.name ?? 'Кот'}: работа завершена, но путь к отдыху недоступен.`)
      if (result.ok) selectedCatId.value = null
      return
    }
    if (reservedCatId) {
      if (targetNode?.type === 'rest') {
        status.value = `${catIndex.value[representedCatId]?.name ?? 'Кот'} продолжает путь на отдых. Выберите рабочее место для будущего назначения.`
        return
      }
      const cat = catIndex.value[representedCatId]
      const result = simulation.cancelCatWorkDestination(representedCatId)
      report(result, `${cat?.name ?? 'Кот'} больше не следует к прежней цели и возвращается отдыхать.`)
      if (result.ok) selectedCatId.value = null
      return
    }
    if (assignedCatId && targetNode?.type !== 'rest' && targetNode?.type !== 'hub') {
      const cat = catIndex.value[representedCatId]
      const result = simulation.clearWorkAssignment(nodeId, slotId)
      report(result, `Назначение для ${cat?.name ?? 'кота'} снято.`)
      if (result.ok) selectedCatId.value = null
      return
    }
    selectCat(representedCatId)
    return
  }
  if (targetNode?.type === 'rest') {
    status.value = 'Все кресла в комнате отдыха используются совместно.'
    return
  }
  if (!selectedCatId.value) {
    const wasSelected = selectedSlot.value?.slotId === slotId
    selectedSlot.value = wasSelected ? null : { nodeId, slotId }
    status.value = wasSelected ? 'Выбор слота отменён.' : 'Слот выбран. Теперь выберите кота.'
    return
  }
  if (assignCatToWorkSlot(selectedCatId.value, nodeId, slotId)) selectedCatId.value = null
}

function cancelCatSelection(event: KeyboardEvent) {
  if (event.key !== 'Escape' || (!selectedCatId.value && !selectedSlot.value && !selectedConnection.value && !selectedModuleId.value)) return
  clearAllSelections()
  status.value = 'Выбор отменён.'
}

function onConnect(connection: FlowConnection) {
  if (!connection.source || !connection.target) return
  const sourcePort = roadPort(connection.sourceHandle)
  const targetPort = roadPort(connection.targetHandle)
  if (sourcePort && targetPort) {
    report(simulation.connectWorkerNodes(connection.source, connection.target, workerTravelSeconds(connection.source, connection.target), sourcePort, targetPort), 'Двунаправленный переход для котов создан.')
    return
  }
  if (connection.sourceHandle === 'data-out' && connection.targetHandle === 'data-in') {
    report(simulation.connect(connection.source, connection.target), 'Направленный канал данных установлен.')
  }
}

function selectConnection(event: EdgeMouseEvent) {
  const wasSelected = selectedConnection.value?.id === event.edge.id
  clearAllSelections()
  if (wasSelected) {
    status.value = 'Выбор связи отменён.'
    return
  }
  selectedConnection.value = { id: event.edge.id, kind: event.edge.data?.kind === 'worker' ? 'worker' : 'data' }
  status.value = selectedConnection.value.kind === 'worker' ? 'Переход для котов выбран. Его можно отключить в панели.' : 'Канал данных выбран. Его можно отключить в панели.'
}

function selectModule(event: NodeMouseEvent) {
  const wasSelected = selectedModuleId.value === event.node.id
  clearAllSelections()
  if (event.node.data.node.blocked) {
    status.value = `${event.node.data.node.name} перекрыт другим узлом. Переместите его, чтобы восстановить доступ.`
    return
  }
  selectedModuleId.value = wasSelected ? null : event.node.id
  status.value = wasSelected ? 'Выбор модуля отменён.' : `${event.node.data.node.name} выбран.`
}

function disconnectSelected() {
  if (!selectedConnection.value) return
  const current = selectedConnection.value
  report(current.kind === 'worker' ? simulation.disconnectWorkerLink(current.id) : simulation.disconnect(current.id), current.kind === 'worker' ? 'Переход для котов отключён.' : 'Канал данных отключён.')
  selectedConnection.value = null
}

function previewNodePosition(event: NodeDragEvent) {
  positions.value[event.node.id] = { ...event.node.position }
}

function updateNodePosition(event: NodeDragEvent) {
  const node = snapshot.value.nodes.find((candidate) => candidate.id === event.node.id)
  if (!node) return
  previewNodePosition(event)
  simulation.setNodePosition(event.node.id, positions.value[event.node.id])
  for (const link of snapshot.value.workerLinks) {
    simulation.updateWorkerLinkTravelTime(link.id, workerTravelSeconds(link.nodeAId, link.nodeBId))
  }
  syncBlockedNodes()
}

function isValidConnection(connection: FlowConnection) {
  if (!connection.source || !connection.target || connection.source === connection.target) return false
  const flowEdge = connection as Edge
  if (flowEdge.id?.startsWith('flight-') || flowEdge.data?.kind === 'flight') return true
  if (connection.sourceHandle === 'data-out' && connection.targetHandle === 'data-in') {
    const isExistingDataConnection = snapshot.value.connections.some((candidate) =>
      candidate.sourceId === connection.source && candidate.targetId === connection.target,
    )
    return isExistingDataConnection || simulation.canConnect(connection.source, connection.target).ok
  }
  const sourcePort = roadPort(connection.sourceHandle)
  const targetPort = roadPort(connection.targetHandle)
  if (!sourcePort || !targetPort) return false
  if (snapshot.value.nodes.find((node) => node.id === connection.source)?.blocked || snapshot.value.nodes.find((node) => node.id === connection.target)?.blocked) return false
  const isExistingRoad = snapshot.value.workerLinks.some((link) =>
    (link.nodeAId === connection.source && link.nodeAPort === sourcePort && link.nodeBId === connection.target && link.nodeBPort === targetPort)
    || (link.nodeBId === connection.source && link.nodeBPort === sourcePort && link.nodeAId === connection.target && link.nodeAPort === targetPort),
  )
  if (isExistingRoad) return true
  return !snapshot.value.workerLinks.some((link) =>
    (link.nodeAId === connection.source && link.nodeAPort === sourcePort)
    || (link.nodeBId === connection.source && link.nodeBPort === sourcePort)
    || (link.nodeAId === connection.target && link.nodeAPort === targetPort)
    || (link.nodeBId === connection.target && link.nodeBPort === targetPort),
  )
}

function setSimulationSpeed(speed: SimulationSpeed) {
  if (showGoalModal.value) return
  simulationSpeed.value = speed
  if (speed !== 0) lastRunningSpeed.value = speed
  status.value = speed === 0 ? 'Симуляция поставлена на паузу.' : `Скорость симуляции: ×${formatGameInteger(speed)}.`
}

function handleKeyboardShortcuts(event: KeyboardEvent) {
  if (showGoalModal.value) return
  cancelCatSelection(event)
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))) return
  if (event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    setSimulationSpeed(simulationSpeed.value === 0 ? lastRunningSpeed.value : 0)
    return
  }
  const speedByKey: Record<string, SimulationSpeed> = { '1': 1, '2': 5, '3': 10 }
  const speed = speedByKey[event.key]
  if (speed === undefined) return
  event.preventDefault()
  setSimulationSpeed(speed)
}

function unlockDiagnosticSpeed() {
  if (diagnosticSpeedUnlocked.value) return
  diagnosticSpeedUnlocked.value = true
  status.value = `Диагностический режим открыт: доступна скорость ×${formatGameInteger(100)}.`
}

function downloadText(contents: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportGame() {
  downloadText(JSON.stringify(simulation.exportSave(), null, 2), 'catmand-save-v5.json')
  status.value = 'Сохранение выгружено в JSON.'
}

function exportInvalidSave() {
  if (!invalidStoredSave) return
  downloadText(invalidStoredSave, 'catmand-incompatible-save.json')
}

function resetTransientState() {
  selectedCatId.value = null
  selectedSlot.value = null
  selectedConnection.value = null
  selectedModuleId.value = null
  const restoredSnapshot = simulation.snapshot()
  showGoalModal.value = restoredSnapshot.goal.achieved && !restoredSnapshot.goal.acknowledged
  simulationSpeed.value = showGoalModal.value ? 0 : 1
  lastRunningSpeed.value = 1
  positions.value = Object.fromEntries(restoredSnapshot.nodes.map((node) => [node.id, node.position ?? { x: 0, y: 0 }]))
  if (showGoalModal.value) void nextTick(() => goalContinueButton.value?.focus())
}

function openGoalModal() {
  showGoalModal.value = true
  simulationSpeed.value = 0
  lastRunningSpeed.value = 1
  void nextTick(() => goalContinueButton.value?.focus())
}

function continueAfterGoal() {
  const result = simulation.acknowledgeGoal()
  if (!result.ok) {
    status.value = result.reason
    return
  }
  showGoalModal.value = false
  simulationSpeed.value = 1
  lastRunningSpeed.value = 1
  sync()
  saveLocalNow()
  status.value = 'Цель PoC достигнута. Лаборатория продолжает работу в режиме песочницы.'
}

async function importGame(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    saveError.value = 'Файл не является корректным JSON. Текущая игра сохранена.'
    invalidStoredSave = text
    return
  }
  const restored = Simulation.fromSave(parsed)
  if (!restored.ok) {
    saveError.value = `${restored.reason} Текущая игра сохранена.`
    invalidStoredSave = text
    return
  }
  simulation = restored.value
  autosaveEnabled = true
  invalidStoredSave = ''
  saveError.value = ''
  resetTransientState()
  sync()
  saveLocalNow()
  status.value = 'Сохранение успешно загружено.'
}

function resetGame() {
  if (!window.confirm('Сбросить лабораторию и начать заново?')) return
  simulation = new Simulation()
  autosaveEnabled = true
  invalidStoredSave = ''
  saveError.value = ''
  window.localStorage.removeItem(SAVE_KEY)
  resetTransientState()
  sync()
  saveLocalNow()
  status.value = 'Создана новая лаборатория.'
}

function acknowledgeEarlyWarning() {
  showEarlyWarning.value = false
  window.localStorage.setItem(SAVE_WARNING_KEY, '1')
}

let frame = 0
let previousTime = 0
const MAX_SIMULATION_STEP_SECONDS = 0.1

function advanceSimulation(deltaSeconds: number) {
  let remainingSeconds = deltaSeconds
  while (remainingSeconds > 0.000000001) {
    const stepSeconds = Math.min(remainingSeconds, MAX_SIMULATION_STEP_SECONDS)
    simulation.tick(stepSeconds)
    remainingSeconds -= stepSeconds
  }
}

function animate(time: number) {
  const elapsed = previousTime ? Math.min((time - previousTime) / 1000, 0.25) : 0
  previousTime = time
  const delta = elapsed * simulationSpeed.value
  if (delta > 0) {
    const wasFlightUnlocked = snapshot.value.flightUnlocked
    const wasGoalAchieved = snapshot.value.goal.achieved
    const travellingCats = new Set(snapshot.value.cats.filter((cat) => cat.status === 'travelling').map((cat) => cat.id))
    advanceSimulation(delta)
    sync()
    const arrivedCat = snapshot.value.cats.find((cat) => travellingCats.has(cat.id) && cat.status === 'idle')
    if (!wasGoalAchieved && snapshot.value.goal.achieved) {
      openGoalModal()
      status.value = 'Цель достигнута: лаборатория перешла в автономный режим.'
    }
    else if (!wasFlightUnlocked && snapshot.value.flightUnlocked) {
      simulationSpeed.value = 1
      lastRunningSpeed.value = 1
      status.value = `Научный прорыв: коты получили возможность летать напрямую между модулями. Скорость снижена до ×${formatGameInteger(1)}.`
    }
    else if (arrivedCat) status.value = `${arrivedCat.name}: прибытие в модуль «${snapshot.value.nodes.find((node) => node.id === arrivedCat.nodeId)?.name ?? 'модуль'}».`
  }
  frame = requestAnimationFrame(animate)
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyboardShortcuts)
  if (showGoalModal.value) void nextTick(() => goalContinueButton.value?.focus())
  frame = requestAnimationFrame(animate)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyboardShortcuts)
  cancelAnimationFrame(frame)
  if (autosaveTimer) clearTimeout(autosaveTimer)
  saveLocalNow()
})
</script>

<template>
  <main class="app-shell" @contextmenu.prevent>
    <div v-if="showGoalModal" class="goal-modal-backdrop">
      <section class="goal-modal" role="dialog" aria-modal="true" aria-labelledby="goal-modal-title" aria-describedby="goal-modal-description">
        <span class="goal-modal__mark" aria-hidden="true">✦</span>
        <p>ЦЕЛЬ ДОСТИГНУТА</p>
        <h2 id="goal-modal-title">АВТОНОМНАЯ ЛАБОРАТОРИЯ</h2>
        <div id="goal-modal-description">
          <p>Все исследовательские лаборатории укомплектованы, воздушная эра открыта, сеть сохраняла прибыль пять минут и достигла чистого дохода 500 кредитов в минуту.</p>
          <p>Испытание PoC завершено — лабораторию можно развивать дальше.</p>
        </div>
        <button ref="goalContinueButton" type="button" @click="continueAfterGoal">Продолжить играть</button>
      </section>
    </div>
    <div v-if="showEarlyWarning" class="early-warning">
      <span>РАННЯЯ РАЗРАБОТКА · сохранения могут стать несовместимыми с будущими версиями.</span>
      <button type="button" @click="acknowledgeEarlyWarning">Понятно</button>
    </div>
    <div v-if="saveError" class="save-error">
      <span>{{ saveError }}</span>
      <button v-if="invalidStoredSave" type="button" @click="exportInvalidSave">Скачать проблемный сейв</button>
      <button type="button" @click="resetGame">Начать заново</button>
    </div>
    <header class="topbar">
      <div class="brand">
        <button class="brand-mark" type="button" aria-label="Логотип лаборатории" @click="unlockDiagnosticSpeed">✦</button>
        <div><p>PURRFECT / SECTOR 07 <span class="app-version">v{{ appVersion }}</span></p><h1>ДАТА-ЛАБОРАТОРИЯ</h1></div>
      </div>
      <div class="topbar-actions">
        <div class="speed-control" aria-label="Скорость симуляции">
          <span>СКОРОСТЬ</span>
          <div class="speed-control__buttons">
            <button
              v-for="option in speedOptions"
              :key="option.value"
              class="speed-button"
              :class="{ 'speed-button--active': simulationSpeed === option.value }"
              type="button"
              :aria-pressed="simulationSpeed === option.value"
              :aria-keyshortcuts="option.shortcut"
              :title="option.value === 0 ? 'Пауза / продолжить · клавиша Пробел' : option.shortcut ? `${option.label} · клавиша ${option.shortcut}` : option.label"
              @click="setSimulationSpeed(option.value)"
            >{{ option.label }}</button>
          </div>
        </div>
        <div class="science-readout"><span>НАУКА / ДАННЫЕ</span><strong>{{ formatGameNumber(totalScience) }}</strong><em>/ {{ formatGameNumber(totalData) }}</em></div>
        <div class="economy-readout" :class="{ 'economy-readout--debt': snapshot.economy.credits < 0 }">
          <span>КРЕДИТЫ</span><strong>{{ formatGameNumber(snapshot.economy.credits) }}</strong>
          <em>{{ formatSignedGameNumber(netIncomePerMinute) }}/мин</em>
          <div class="expense-visualization">
            <span class="expense-label">РАСХОДЫ / МИН</span>
            <div class="expense-line">
              <div class="expense-bar" role="group" :aria-label="expenseAriaLabel">
                <span
                  v-for="segment in expenseSegments"
                  :key="segment.key"
                  class="expense-segment"
                  :class="`expense-segment--${segment.key}`"
                  :style="{ width: `${segment.percentage}%` }"
                  role="img"
                  :aria-label="`${segment.label}: ${formatGameNumber(segment.value)} в минуту`"
                  :title="`${segment.label}: ${formatGameNumber(segment.value)}/мин`"
                ></span>
              </div>
              <small>−{{ formatGameNumber(snapshot.economy.upkeepPerMinute) }}</small>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section class="workspace">
      <aside class="control-panel">
        <section
          class="research-project"
          :class="{ 'research-project--complete': snapshot.flightUnlocked }"
          aria-labelledby="flight-research-title"
        >
          <div class="research-project__eyebrow">
            <span>ИССЛЕДОВАТЕЛЬСКИЙ ПРОЕКТ</span>
            <span>{{ snapshot.flightUnlocked ? 'ЗАВЕРШЁН' : 'В РАБОТЕ' }}</span>
          </div>
          <div class="research-project__title">
            <span aria-hidden="true">✦</span>
            <strong id="flight-research-title">ВОЗДУШНАЯ ЭРА</strong>
          </div>
          <div
            class="research-project__progress"
            role="progressbar"
            aria-label="Прогресс исследования Воздушная эра"
            :aria-valuenow="Math.min(totalScience, GAME_BALANCE.science.flightUnlockProgress)"
            aria-valuemin="0"
            :aria-valuemax="GAME_BALANCE.science.flightUnlockProgress"
          >
            <span :style="{ width: `${flightResearchProgress}%` }"></span>
          </div>
          <div class="research-project__value">
            <strong>{{ formatGameNumber(Math.min(totalScience, GAME_BALANCE.science.flightUnlockProgress)) }} / {{ formatGameInteger(GAME_BALANCE.science.flightUnlockProgress) }}</strong>
            <span>НАУКИ</span>
          </div>
          <p v-if="snapshot.flightUnlocked">Коты могут летать напрямую между модулями.</p>
          <p v-else>Назначайте котов в исследовательские модули, чтобы приблизить научный прорыв.</p>
        </section>
        <section class="objective-card" :class="{ 'objective-card--achieved': snapshot.goal.achieved }" aria-labelledby="objective-title">
          <div class="objective-card__heading">
            <span>ЦЕЛЬ PoC</span>
            <strong id="objective-title">АВТОНОМНАЯ ЛАБОРАТОРИЯ</strong>
          </div>
          <div class="objective-condition" :class="{ 'objective-condition--complete': snapshot.goal.achieved || researchGoalComplete }">
            <span aria-hidden="true">{{ snapshot.goal.achieved || researchGoalComplete ? '✓' : '○' }}</span>
            <div><small>ЛАБОРАТОРИИ УКОМПЛЕКТОВАНЫ</small><strong>{{ fullyStaffedResearchCount }} / {{ requiredResearchDisplayCount }}</strong></div>
          </div>
          <div class="objective-condition" :class="{ 'objective-condition--complete': scienceGoalComplete }">
            <span aria-hidden="true">{{ scienceGoalComplete ? '✓' : '○' }}</span>
            <div><small>ВОЗДУШНАЯ ЭРА</small><strong>{{ scienceGoalComplete ? 'ЗАВЕРШЕНА' : 'ИССЛЕДУЕТСЯ' }}</strong></div>
          </div>
          <div class="objective-condition" :class="{ 'objective-condition--complete': snapshot.goal.peakNetIncomePerMinute >= GAME_BALANCE.objective.requiredPeakNetIncomePerMinute }">
            <span aria-hidden="true">{{ snapshot.goal.peakNetIncomePerMinute >= GAME_BALANCE.objective.requiredPeakNetIncomePerMinute ? '✓' : '○' }}</span>
            <div><small>ПИКОВАЯ ПРИБЫЛЬ</small><strong>{{ formatGameNumber(snapshot.goal.peakNetIncomePerMinute) }} / {{ formatGameInteger(GAME_BALANCE.objective.requiredPeakNetIncomePerMinute) }} /МИН</strong></div>
          </div>
          <div class="objective-condition objective-condition--timer" :class="{ 'objective-condition--complete': profitGoalComplete }">
            <span aria-hidden="true">{{ profitGoalComplete ? '✓' : '○' }}</span>
            <div class="objective-timer">
              <div><small>СТАБИЛЬНАЯ ПРИБЫЛЬ</small><strong>{{ formatGoalDuration(snapshot.goal.profitableSeconds) }} / {{ formatGoalDuration(GAME_BALANCE.objective.requiredProfitableSeconds) }}</strong></div>
              <div
                class="objective-timer__progress"
                role="progressbar"
                aria-label="Непрерывное время прибыльной работы"
                :aria-valuenow="Math.min(snapshot.goal.profitableSeconds, GAME_BALANCE.objective.requiredProfitableSeconds)"
                aria-valuemin="0"
                :aria-valuemax="GAME_BALANCE.objective.requiredProfitableSeconds"
              ><span :style="{ width: `${profitTimerProgress}%` }"></span></div>
            </div>
          </div>
          <p v-if="!snapshot.goal.achieved" class="objective-card__hint">Нужно минимум две лаборатории с назначениями 2/2. Таймер сбрасывается при доходе ≤ расходов; достигнутый пик 500/мин сохраняется.</p>
          <p v-if="snapshot.goal.acknowledged" class="objective-card__sandbox">ЦЕЛЬ ДОСТИГНУТА · ПЕСОЧНИЦА ПРОДОЛЖАЕТСЯ</p>
        </section>
        <p class="panel-label">КОНСТРУКТОР СЕТИ</p>
        <button v-if="showRestConstruction" class="action-button" type="button" :disabled="snapshot.economy.credits < GAME_BALANCE.nodes.rest.cost" @click="createNode('rest')"><span>⌂</span> Комната отдыха · {{ formatGameInteger(GAME_BALANCE.nodes.rest.cost) }}</button>
        <button class="action-button" type="button" :disabled="snapshot.economy.credits < GAME_BALANCE.nodes.research.cost" @click="createNode('research')"><span>✦</span> Исследования · {{ formatGameInteger(GAME_BALANCE.nodes.research.cost) }}</button>
        <button v-if="showServerConstruction" class="action-button" type="button" :disabled="snapshot.economy.credits < GAME_BALANCE.nodes.server.cost" @click="createNode('server')"><span>▦</span> Сервер · {{ formatGameInteger(GAME_BALANCE.nodes.server.cost) }}</button>
        <button v-if="showTerminalConstruction" class="action-button" type="button" :disabled="snapshot.economy.credits < GAME_BALANCE.nodes.terminal.cost" @click="createNode('terminal')"><span>₡</span> Торговый терминал · {{ formatGameInteger(GAME_BALANCE.nodes.terminal.cost) }}</button>
        <button v-if="showHubConstruction" class="action-button" type="button" :disabled="snapshot.economy.credits < GAME_BALANCE.nodes.hub.cost" @click="createNode('hub')"><span>◆</span> Дорожный хаб · {{ formatGameInteger(GAME_BALANCE.nodes.hub.cost) }}</button>
        <p v-if="snapshot.economy.debtWarning" class="debt-warning">ЛАБОРАТОРИЯ ЗАКРЫТА · ранний доступ позволяет продолжить восстановление.</p>
        <button v-if="selectedConnection" class="action-button action-button--disconnect" type="button" @click="disconnectSelected"><span>×</span> Отключить связь</button>
        <button v-if="selectedModuleId" class="action-button action-button--danger" type="button" @click="deleteSelectedNode"><span>×</span> Удалить выбранный модуль</button>
        <div class="panel-rule"></div>
        <p class="panel-label">ЭКИПАЖ</p>
        <button class="hire-button" type="button" :disabled="!canHireCat" @click="hireCat"><span>◕</span> Нанять кота · {{ formatGameInteger(GAME_BALANCE.economy.hireCatCost) }}</button>
        <section class="crew-roster-section" aria-label="Коты без работы">
          <div class="crew-roster-heading"><span>БЕЗ РАБОТЫ</span><strong>{{ unassignedCats.length }}</strong></div>
          <div v-if="unassignedCats.length" class="crew-roster-list">
            <button
              v-for="cat in unassignedCats"
              :key="cat.id"
              class="crew-cat-button"
              :class="{ 'crew-cat-button--selected': selectedCatId === cat.id }"
              type="button"
              :aria-pressed="selectedCatId === cat.id"
              :title="`Выбрать ${cat.name} для назначения на работу`"
              @click="selectCat(cat.id)"
            >
              <span class="crew-cat-glyph" aria-hidden="true">{{ cat.variant }}</span>
              <span class="crew-cat-details"><strong>{{ cat.name }}</strong><small>{{ unassignedCatState(cat) }}</small></span>
              <span class="crew-cat-vigor" title="Бодрость">{{ formatVigor(cat.vigor) }}</span>
            </button>
          </div>
          <p v-else class="crew-roster-empty">ВСЕ КОТЫ НАЗНАЧЕНЫ</p>
        </section>
        <button class="action-button action-button--danger" type="button" :disabled="!canDismissSelectedCat" @click="dismissSelectedCat"><span>−</span> Уволить кота · {{ formatGameInteger(GAME_BALANCE.economy.dismissCatCost) }}</button>
        <div class="panel-rule"></div>
        <p class="panel-label">СОХРАНЕНИЕ</p>
        <button class="action-button" type="button" @click="exportGame"><span>⇩</span> Выгрузить JSON</button>
        <label class="action-button file-button"><span>⇧</span> Загрузить JSON<input type="file" accept="application/json,.json" @change="importGame" /></label>
        <button class="action-button action-button--danger" type="button" @click="resetGame"><span>↺</span> Начать заново</button>
        <div class="hint">
          <span class="hint-number">01</span>
          <p v-if="!snapshot.flightUnlocked">Стальные дуги — путь котов.<br />Время зависит от модулей, не изгиба.<br />Циановые каналы передают данные.</p>
          <p v-else>Коты летают напрямую между модулями.<br />Дороги можно строить, но коты их игнорируют.<br />Циановые каналы передают данные.</p>
        </div>
      </aside>

      <section ref="graphFrame" class="graph-frame" aria-label="Граф лаборатории">
        <VueFlow
          :nodes="flowNodes"
          :edges="renderedEdges"
          :node-types="nodeTypes"
          :edge-types="edgeTypes"
          :default-viewport="{ x: 0, y: 0, zoom: 0.92 }"
          :min-zoom="0.55"
          :max-zoom="1.4"
          :fit-view-on-init="false"
          :nodes-draggable="true"
          :connection-mode="ConnectionMode.Loose"
          :is-valid-connection="isValidConnection"
          @init="handleFlowInit"
          @connect="onConnect"
          @edge-click="selectConnection"
          @node-click="selectModule"
          @node-drag="previewNodePosition"
          @node-drag-stop="updateNodePosition"
        >
          <template #connection-line="{ sourceX, sourceY, targetX, targetY }">
            <path class="connection-preview" :d="`M ${sourceX},${sourceY} L ${targetX},${targetY}`" />
          </template>
        </VueFlow>
        <div class="graph-status" :class="{ 'graph-status--selection': selectedCatId || selectedSlot || selectedConnection || selectedModuleId }"><span class="status-dot"></span>{{ status }}</div>
        <div class="canvas-caption"><span>LIVE SIMULATION</span><b>{{ formatGameInteger(simulationSpeed) }}×</b></div>
      </section>
    </section>
  </main>
</template>

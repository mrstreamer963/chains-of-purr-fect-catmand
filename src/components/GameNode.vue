<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { GAME_BALANCE, type Cat, type SimNode, type WorkSlot } from '../core'
import { formatGameInteger, formatGameNumber, formatVigor } from '../formatGameNumber'

interface NodeViewData {
  node: SimNode
  blocked?: boolean
  cats: Record<string, Cat>
  unreachableCatIds?: string[]
  unassignedCatIds?: string[]
  restWaitingCats: Cat[]
  strandedCats?: Cat[]
  selectedCatId: string | null
  selectedSlotId: string | null
  onCatClick: (catId: string) => void
  onSlotClick: (nodeId: string, slotId: string, catId: string | null, reservedCatId: string | null, assignedCatId: string | null) => void
}

const props = defineProps<NodeProps<NodeViewData>>()
const hubPorts = [
  { name: 'north', position: Position.Top },
  { name: 'east', position: Position.Right },
  { name: 'south', position: Position.Bottom },
  { name: 'west', position: Position.Left },
] as const

function cannotReachAssignedSlot(slot: WorkSlot) {
  const cat = slot.assignedCatId ? props.data.cats[slot.assignedCatId] : undefined
  return props.data.node.type !== 'rest'
    && props.data.node.type !== 'hub'
    && !slot.catId
    && !slot.reservedByCatId
    && cat?.status === 'idle'
    && cat.vigor >= GAME_BALANCE.cats.maxVigor
    && cat.nodeId !== props.data.node.id
}

function cannotReachAssignedWork(catId: string) {
  return props.data.unreachableCatIds?.includes(catId) ?? false
}

function isUnassignedRestCat(slot: WorkSlot) {
  return props.data.node.type === 'rest' && Boolean(slot.catId && props.data.unassignedCatIds?.includes(slot.catId))
}

function representsSelectedCat(slot: WorkSlot) {
  return Boolean(props.data.selectedCatId && [slot.catId, slot.reservedByCatId, slot.assignedCatId].includes(props.data.selectedCatId))
}

function slotTitle(slot: WorkSlot) {
  if (slot.catId && props.data.node.type !== 'rest') return 'Нажмите, чтобы выбрать кота. Повторный клик отправит его отдыхать.'
  if (slot.reservedByCatId && props.data.node.type === 'rest') return 'Нажмите, чтобы выбрать кота. Выберите рабочий слот для будущего назначения.'
  if (slot.reservedByCatId) return 'Нажмите, чтобы выбрать кота. Повторный клик отменит цель и отправит его отдыхать.'
  if (slot.assignedCatId) return 'Нажмите, чтобы выбрать кота. Повторный клик снимет рабочее назначение.'
  return undefined
}

function slotAriaLabel(slot: WorkSlot, slotIndex: number) {
  const catId = slot.catId ?? slot.reservedByCatId ?? slot.assignedCatId
  const catName = catId ? props.data.cats[catId]?.name ?? 'Кот' : null
  const state = slot.catId
    ? props.data.node.type === 'rest' ? 'отдыхает' : 'работает'
    : slot.reservedByCatId ? 'в пути'
      : slot.assignedCatId ? 'назначен после отдыха'
        : 'свободно'
  return `Место ${slotIndex + 1}, ${props.data.node.name}: ${catName ? `${catName}, ${state}` : state}. ${slotTitle(slot) ?? 'Нажмите, чтобы выбрать это место.'}`
}

const nodeIcons = { rest: '⌂', research: '✦', server: '▦', hub: '◆', terminal: '₡' }
const nodeSubtitles = {
  rest: 'Кот-операторы в резерве',
  research: 'Производство научных данных',
  server: 'Приём и хранение данных',
  hub: 'Развязка дорожной сети',
  terminal: 'Автоматическая продажа данных',
}
</script>

<template>
  <article class="game-node" :class="[`game-node--${data.node.type}`, { 'game-node--blocked': data.blocked }]">
    <template v-if="data.node.type === 'hub'">
      <Handle
        v-for="port in hubPorts"
        :key="`${port.name}-target`"
        :id="`hub-${port.name}`"
        class="game-handle game-handle--road"
        type="target"
        :position="port.position"
      />
      <Handle
        v-for="port in hubPorts"
        :key="port.name"
        :id="`hub-${port.name}`"
        class="game-handle game-handle--road"
        type="source"
        :position="port.position"
      />
      <span class="hub-icon" aria-hidden="true">◆</span>
      <strong>ДОРОЖНЫЙ ХАБ</strong>
      <p>{{ formatGameInteger(hubPorts.length) }} направления</p>
      <p v-if="data.blocked" class="node-blocked-message">ПЕРЕКРЫТИЕ · ПЕРЕМЕСТИТЕ</p>
      <section v-if="data.strandedCats?.length" class="stranded-cats" aria-label="Коты без маршрута">
        <span v-for="cat in data.strandedCats" :key="cat.id">{{ cat.variant }} {{ cat.name }} · путь недоступен</span>
      </section>
    </template>

    <template v-else>
      <Handle
        v-if="data.node.type === 'server' || data.node.type === 'terminal'"
        id="data-in"
        class="game-handle game-handle--input"
        type="target"
        :position="Position.Left"
      />

      <header class="node-header">
        <span class="node-icon" aria-hidden="true">{{ nodeIcons[data.node.type] }}</span>
        <div>
          <p class="node-eyebrow">{{ data.node.type === 'rest' ? 'БАЗОВЫЙ МОДУЛЬ' : 'РАБОЧИЙ МОДУЛЬ' }}</p>
          <h2>{{ data.node.name }}</h2>
          <p class="node-subtitle">{{ nodeSubtitles[data.node.type] }}</p>
        </div>
      </header>

      <section class="slot-grid" aria-label="Рабочие слоты">
        <button
          v-for="(slot, slotIndex) in data.node.slots"
          :key="slot.id"
          class="worker-slot nodrag nopan"
          :class="{ 'worker-slot--selected': representsSelectedCat(slot) || slot.id === data.selectedSlotId, 'worker-slot--occupied': slot.catId, 'worker-slot--reserved': slot.reservedByCatId, 'worker-slot--assigned': slot.assignedCatId, 'worker-slot--unassigned': isUnassignedRestCat(slot), 'worker-slot--exhausted': data.node.type !== 'rest' && slot.catId && (data.cats[slot.catId]?.vigor ?? 0) <= 0, 'worker-slot--unreachable': cannotReachAssignedSlot(slot) }"
          type="button"
          :title="slotTitle(slot)"
          :aria-label="slotAriaLabel(slot, slotIndex)"
          :disabled="data.blocked"
          @click.stop="data.onSlotClick(data.node.id, slot.id, slot.catId, slot.reservedByCatId, slot.assignedCatId)"
        >
          <template v-if="slot.catId">
            <span class="cat-glyph" aria-hidden="true">{{ data.cats[slot.catId]?.variant }}</span>
            <span v-if="cannotReachAssignedWork(slot.catId)" class="cat-route-warning" title="Не может добраться до назначенной работы" aria-label="Не может добраться до назначенной работы">!</span>
            <span class="cat-name" @click.stop="data.onCatClick(slot.catId)">{{ data.cats[slot.catId]?.name }}</span>
            <span class="cat-vigor" title="Бодрость">{{ formatVigor(data.cats[slot.catId]?.vigor ?? 0) }}</span>
            <span v-if="isUnassignedRestCat(slot)" class="slot-state slot-state--unassigned">без работы</span>
            <span v-if="data.node.type !== 'rest' && (data.cats[slot.catId]?.vigor ?? 0) <= 0" class="slot-state slot-state--warning">отдых недоступен</span>
          </template>
          <template v-else-if="slot.reservedByCatId">
            <span class="cat-glyph cat-glyph--travelling" aria-hidden="true">↝</span>
            <span>{{ data.cats[slot.reservedByCatId]?.name }}</span>
            <span class="slot-state">в пути</span>
          </template>
          <template v-else-if="slot.assignedCatId">
            <span class="cat-glyph cat-glyph--assigned" aria-hidden="true">{{ data.cats[slot.assignedCatId]?.variant }}</span>
            <span class="cat-name">{{ data.cats[slot.assignedCatId]?.name }}</span>
            <span v-if="cannotReachAssignedSlot(slot)" class="slot-state slot-state--warning">путь недоступен</span>
            <span v-else class="slot-state">{{ (data.cats[slot.assignedCatId]?.vigor ?? 0) >= 100 ? 'ждёт путь' : 'отдыхает' }}</span>
          </template>
          <template v-else><span class="empty-slot-mark">+</span><span>свободно</span></template>
        </button>
      </section>

      <p v-if="data.blocked" class="node-blocked-message">ПЕРЕКРЫТИЕ · ПЕРЕМЕСТИТЕ УЗЕЛ</p>

      <section v-if="data.strandedCats?.length" class="stranded-cats" aria-label="Коты без маршрута">
        <span v-for="cat in data.strandedCats" :key="cat.id">{{ cat.variant }} {{ cat.name }} · путь недоступен</span>
      </section>

      <section v-if="data.node.type === 'rest' && data.restWaitingCats.length" class="rest-waiting" aria-label="Очередь отдыха">
        <span>ЖДУТ КРЕСЛА</span>
        <button v-for="cat in data.restWaitingCats" :key="cat.id" class="rest-waiting__cat nodrag nopan" type="button" @click.stop="data.onCatClick(cat.id)">
          {{ cat.variant }} {{ cat.name }} · {{ formatVigor(cat.vigor) }}<span v-if="cannotReachAssignedWork(cat.id)" class="cat-route-warning" title="Не может добраться до назначенной работы" aria-label="Не может добраться до назначенной работы">!</span>
        </button>
      </section>

      <footer class="node-metrics" :class="{ 'node-metrics--single': data.node.type === 'terminal' }">
        <template v-if="data.node.type === 'research'"><div><span>Выработка</span><strong>{{ formatGameNumber(data.node.productionRate) }} <small>ед/с</small></strong></div><div :class="{ warning: data.node.dataBuffer > 0.75 }"><span>Буфер</span><strong>{{ formatGameNumber(data.node.dataBuffer) }} <small>данных</small></strong></div></template>
        <template v-else-if="data.node.type === 'server'"><div><span>Приём / выход</span><strong>{{ formatGameNumber(data.node.inputRate) }} / {{ formatGameNumber(data.node.outputRate) }} <small>ед/с</small></strong></div><div><span>Хранилище</span><strong>{{ formatGameNumber(data.node.dataStored) }} <small>данных</small></strong></div></template>
        <template v-else-if="data.node.type === 'terminal'"><div><span>Продажа</span><strong>{{ formatGameNumber(data.node.inputRate) }} <small>ед/с</small></strong></div></template>
        <template v-else><div><span>Мест</span><strong>{{ formatGameInteger(data.node.slots.filter((slot) => !slot.catId).length) }} <small>свободно</small></strong></div><div><span>Статус</span><strong>тихо</strong></div></template>
      </footer>

      <Handle id="road" class="game-handle game-handle--road" type="target" :position="Position.Bottom" />
      <Handle id="road" class="game-handle game-handle--road" type="source" :position="Position.Bottom" />
      <Handle v-if="data.node.type === 'research' || data.node.type === 'server'" id="data-out" class="game-handle game-handle--output" type="source" :position="Position.Right" />
    </template>
  </article>
</template>

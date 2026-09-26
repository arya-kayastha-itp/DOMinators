import type { ConsoleEvent } from '@/lib/contracts'
import { edges } from './fleet'

// Seed audit trail: what the orchestrator's events table would hold after this
// morning's discovery + planning runs. Live runs in the console append to it.
const base = Date.parse('2026-09-26T08:55:00Z')
const at = (sec: number) => new Date(base + sec * 1000).toISOString()

let id = 1
const ev = (sec: number, e: Omit<ConsoleEvent, 'id' | 'ts'>): ConsoleEvent => ({ id: id++, ts: at(sec), ...e })

export const seedEvents: ConsoleEvent[] = [
  ev(0, { agent: 'discovery', app_id: null, type: 'DISCOVERY_STARTED', level: 'info', payload: { scope: 'all', role: 'mig-discovery-readonly' }, summary: 'Assumed mig-discovery-readonly in Account A (two-hop, ExternalId)' }),
  ev(2, { agent: 'discovery', app_id: 'app-catalog', type: 'APP_DISCOVERED', level: 'info', payload: { findings: 7 }, summary: 'app-catalog · 7 findings · GOLDEN', decided_by: 'rules' }),
  ev(2, { agent: 'discovery', app_id: 'app-pricing', type: 'APP_DISCOVERED', level: 'info', payload: { findings: 9 }, summary: 'app-pricing · 9 findings · GOLDEN', decided_by: 'rules' }),
  ev(3, { agent: 'discovery', app_id: 'app-orders', type: 'APP_DISCOVERED', level: 'info', payload: { findings: 9 }, summary: 'app-orders · 9 findings · GOLDEN', decided_by: 'rules' }),
  ev(3, { agent: 'discovery', app_id: 'app-orders', type: 'TOOL_CALL', level: 'info', payload: { tool: 'describe_images', args: { ImageIds: ['ami-0b60ca38391b1a1ee'], IncludeDeprecated: true }, result: 'created 2023-02-24 · deprecated' }, summary: 'OLD_AMI confirmed via describe_images (IncludeDeprecated=true)' }),
  ev(4, { agent: 'discovery', app_id: null, type: 'TOOL_CALL', level: 'info', payload: { tool: 'describe_route_tables', args: { VpcId: 'vpc-0bc12dd6664275ce7' }, result: 'every effective RT routes 0.0.0.0/0 → igw' }, summary: 'NO_VPC_SEGMENTATION: no subnet has a private route table' }),
  ev(5, { agent: 'discovery', app_id: null, type: 'APP_DISCOVERED', level: 'info', payload: { batch: 50, synthetic: true }, summary: 'Ingested synthetic fleet in batches of 50 (1,000 records)' }),
  ev(6, { agent: 'discovery', app_id: 'syn-00007', type: 'TOOL_CALL', level: 'info', payload: { tool: 'submit_tiering', args: { app_id: 'syn-00007', tier: 'GRAY', reasons: ['ecs task with hardcoded endpoint — mapping onto golden_app needs review'] }, result: 'accepted' }, summary: 'Ambiguous ECS mapping → Claude tiered syn-00007 GRAY', decided_by: 'llm' }),
  ev(8, { agent: 'discovery', app_id: null, type: 'DISCOVERY_DONE', level: 'success', payload: { apps_total: 1003, edges: edges.length, duration_ms: 2840 }, summary: 'Discovery complete · 1,003 apps · 2.84 s' }),
  ev(40, { agent: 'planning', app_id: null, type: 'PLAN_DONE', level: 'success', payload: { capacity_per_wave: 12 }, summary: 'Wave plan committed · Wave 0 = 3 real apps', decided_by: 'rules' }),
  ev(60, { agent: 'orchestrator', app_id: 'syn-00005', type: 'SIM_LICENSE_FLAG', level: 'warn', payload: { license: 'commercial' }, summary: 'syn-00005 commercial license, no BYOL → parked (RED)' }),
  ev(75, { agent: 'orchestrator', app_id: 'syn-00002', type: 'SIM_DATA_MIGRATION', level: 'info', payload: { progress: 0.4 }, summary: 'syn-00002 stateful — replication plan drafted (simulated)' }),
]

export const nextEventId = () => id++

import { evidenceRevision } from '../evidence/demo-evidence'

export type DemoContext = {
  companyId: string
  companyName: string
  industry: string
  report: string
  scope: string
  lease: 'include' | 'exclude'
}

export const demoVersions = {
  source: 'demo-v1',
  financial: 'demo-formula-v1',
  rule: 'demo-rule-v1',
  evidence: evidenceRevision,
  model: '미연동',
} as const

export function contextKey(context: DemoContext) {
  return `${context.companyId}.${context.report}.${context.scope}.${context.lease}.${demoVersions.source}`
}

export function contextLabel(context: DemoContext) {
  return `${context.companyName} / ${context.report} 사업보고서 / ${context.scope} / 리스부채 ${context.lease === 'include' ? '포함' : '제외'} / ${demoVersions.source}`
}

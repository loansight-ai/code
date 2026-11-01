import { useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { z } from 'zod'
import { ChevronDown, FileText } from 'lucide-react'
import { Button } from '../../shared/components/button'
import { StatusBadge } from '../../shared/components/status-badge'
import { SessionContext } from '../session/session-context'
import { request } from '../session/api'
import './report-links.css'

export function ReportEvidenceLinks({ corpCode }: { corpCode: string | null }) {
  const session = useContext(SessionContext)
  const owner =
    session?.phase === 'ready' ? session.session?.workspace_id : undefined
  const query = useQuery({
    queryKey: ['server', owner, 'evidence-reports', corpCode],
    queryFn: async ({ signal }) =>
      z
        .object({
          reports: z.array(
            z.object({
              receipt_no: z.string(),
              period: z.string(),
              scope: z.string(),
              report_id: z.string(),
            }),
          ),
        })
        .parse(
          await request(`/me/companies/${corpCode}/evidence-reports`, {
            signal,
          }),
        ),
    enabled: !!corpCode && !!owner,
    retry: false,
  })
  if (!owner || !query.data?.reports.length) return null
  return (
    <details className="report-evidence">
      <summary className="report-evidence-heading">
        <FileText size={16} aria-hidden="true" />
        <span>저장된 주석·공시 근거</span>
        <span className="report-evidence-count">
          {query.data.reports.length}건
        </span>
        <ChevronDown
          className="report-evidence-chevron"
          size={16}
          aria-hidden="true"
        />
      </summary>
      <div className="report-evidence-content">
        <p className="report-evidence-description">
          재무 분석 없이 주석과 사건 이력을 확인할 수 있습니다.
        </p>
        <ul className="report-evidence-list">
          {query.data.reports.map((r) => (
            <li key={r.report_id} className="report-evidence-item">
              <div className="report-evidence-period">
                <strong>{r.period} 결산</strong>
                <StatusBadge>
                  {r.scope === 'OFS'
                    ? '별도'
                    : r.scope === 'CFS'
                      ? '연결'
                      : r.scope}
                </StatusBadge>
              </div>
              <div className="report-evidence-actions">
                <Button asChild variant="outline">
                  <Link
                    to={`/reports/${corpCode}/${r.receipt_no}/${r.scope}/evidence`}
                  >
                    주석·위험징후
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link
                    to={`/reports/${corpCode}/${r.receipt_no}/${r.scope}/prediction`}
                  >
                    위험 사건 예측
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}

export function CombinedEvidenceLink({
  corpCode,
  receiptNo,
  scope,
  structureId,
}: {
  corpCode: string
  receiptNo: string
  scope: string
  structureId?: string
}) {
  return (
    <Link
      to={`/reports/${corpCode}/${receiptNo}/${scope}/evidence${structureId ? `?structure_id=${structureId}` : ''}`}
    >
      저장된 공시와 함께 근거 검색 →
    </Link>
  )
}

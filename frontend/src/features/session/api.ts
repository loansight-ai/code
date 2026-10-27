import { z } from 'zod'

export const sessionSchema = z.object({
  user_id: z.string().uuid(),
  user_code: z.string().regex(/^[0-9]{5}$/),
  workspace_id: z.string().uuid(),
})
export type Session = z.infer<typeof sessionSchema>

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public retryAfter: string | null,
  ) {
    super(detail)
  }
}

export async function request(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(
      response.status,
      typeof body.detail === 'string' ? body.detail : 'request_failed',
      response.headers.get('Retry-After'),
    )
  }
  return response.status === 204 ? undefined : response.json()
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.detail === 'invalid_user_code')
      return '발급된 5자리 코드를 확인해 주세요.'
    if (error.status === 401)
      return '세션이 만료되었습니다. 코드로 다시 접속해 주세요.'
    if (error.status === 429)
      return `접속 시도가 많습니다. ${error.retryAfter && /^[0-9]+$/.test(error.retryAfter) ? `${error.retryAfter}초 후` : '잠시 후'} 다시 시도해 주세요.`
    if (error.status === 403)
      return '접속 주소가 허용되지 않았습니다. 서버의 허용 출처 설정을 확인해 주세요.'
    if (error.status === 409)
      return '작업 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.'
    if (error.status === 404)
      return '현재 사용자에게 연결된 작업을 찾을 수 없습니다.'
    if (error.status === 503)
      return '서버가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.'
  }
  return '서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.'
}

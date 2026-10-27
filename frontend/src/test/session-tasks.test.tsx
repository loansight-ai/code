import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionProvider } from '../features/session/session-provider'
import { SessionControls } from '../features/session/session-controls'
import { TaskControls } from '../features/tasks/task-controls'
import { useTasks } from '../features/tasks/task-context'
import { useSession } from '../features/session/session-context'
import { mergeTask, type Task } from '../features/tasks/task-state'

const session = {
  user_id: '00000000-0000-4000-8000-000000000001',
  user_code: '00427',
  workspace_id: '00000000-0000-4000-8000-000000000002',
}
const other = {
  user_id: '00000000-0000-4000-8000-000000000003',
  user_code: '00008',
  workspace_id: '00000000-0000-4000-8000-000000000004',
}
const stream = '00000000-0000-4000-8000-000000000005'
const task: Task = {
  task_id: '00000000-0000-4000-8000-000000000006',
  job_id: '00000000-0000-4000-8000-000000000007',
  task_type: 'PIPELINE_CHECK',
  analysis_run_id: null,
  status: 'QUEUED',
  stage: 'QUEUED',
  state_version: 1,
  attempt: 0,
  error_code: null,
  occurred_at: '2026-10-27T00:00:00Z',
  acknowledged: false,
}
class FakeSource extends EventTarget {
  static CLOSED = 2
  static instances: FakeSource[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(public url: string) {
    super()
    FakeSource.instances.push(this)
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  emit(name: string, data: unknown, sequence = 1) {
    this.dispatchEvent(
      new MessageEvent(name, {
        data: JSON.stringify(data),
        lastEventId: `${stream}:${sequence}`,
      }),
    )
  }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
let active: typeof session | null
let snapshot: Task[]
let snapshotNumber: number
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(() => {
  FakeSource.instances = []
  active = session
  snapshot = [task]
  snapshotNumber = 0
  vi.stubGlobal('EventSource', FakeSource)
  vi.stubGlobal('BroadcastChannel', undefined)
  fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url)
    if (path === '/api/v1/session' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      if (body.user_code === other.user_code) active = other
      else if (body.user_code !== session.user_code)
        return json({ detail: 'invalid_user_code' }, 401)
      else active = session
      return json(active)
    }
    if (path === '/api/v1/session' && init?.method === 'DELETE') {
      active = null
      return new Response(null, { status: 204 })
    }
    if (path === '/api/v1/session')
      return active ? json(active) : json({ detail: 'session_required' }, 401)
    if (path === '/api/v1/users') {
      active = other
      return json(other, 201)
    }
    if (path === '/api/v1/me/tasks')
      return json({
        tasks: active === other ? [] : snapshot,
        event_cursor: `${stream}:${snapshotNumber}`,
      })
    if (path.endsWith('/acknowledgement'))
      return json({
        ...task,
        status: 'SUCCEEDED',
        stage: 'COMPLETED',
        state_version: 3,
        acknowledged: true,
      })
    if (path.endsWith('/diagnostics')) return json(task, 202)
    if (path.endsWith(task.task_id))
      return json({ ...task, result: { financial_analysis_performed: false } })
    throw new Error(`Unexpected request ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

function Probe() {
  const { tasks, connection } = useTasks()
  const { session: current } = useSession()
  return (
    <>
      <SessionControls />
      <TaskControls />
      <output data-testid="identity">{current?.user_code}</output>
      <output data-testid="tasks">
        {tasks
          .map((value) => `${value.status}:${value.state_version}`)
          .join(',')}
      </output>
      <output data-testid="connection">{connection}</output>
    </>
  )
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { ...view, client }
}
async function source() {
  await waitFor(() =>
    expect(FakeSource.instances.filter((value) => !value.closed)).toHaveLength(
      1,
    ),
  )
  return FakeSource.instances.find((value) => !value.closed)!
}

it('restores session and snapshot before subscribing and ignores duplicate and older states', async () => {
  const { unmount } = mount()
  const events = await source()
  expect(screen.getByTestId('identity')).toHaveTextContent('00427')
  expect(events.url).toContain(encodeURIComponent(`${stream}:0`))
  act(() => {
    events.emit(
      'task.completed',
      { ...task, state_version: 3, status: 'SUCCEEDED' },
      2,
    )
    events.emit(
      'task.updated',
      { ...task, state_version: 2, status: 'RUNNING' },
      3,
    )
    events.emit('task.updated', task, 1)
  })
  await waitFor(() =>
    expect(screen.getByTestId('tasks')).toHaveTextContent('SUCCEEDED:3'),
  )
  act(() =>
    events.emit(
      'task.acknowledged',
      { ...task, state_version: 3, status: 'SUCCEEDED', acknowledged: true },
      4,
    ),
  )
  await waitFor(() => expect(screen.getByTestId('tasks')).toBeEmptyDOMElement())
  unmount()
  expect(events.closed).toBe(true)
})

it('closes on reset and restores a new snapshot and cursor without creating a task', async () => {
  mount()
  const events = await source()
  snapshot = [{ ...task, status: 'RUNNING', state_version: 2 }]
  snapshotNumber = 10
  act(() => events.emit('reset', {}))
  await waitFor(() => expect(FakeSource.instances).toHaveLength(2))
  expect(events.closed).toBe(true)
  expect(FakeSource.instances[1].url).toContain(
    encodeURIComponent(`${stream}:10`),
  )
  await waitFor(() =>
    expect(screen.getByTestId('tasks')).toHaveTextContent('RUNNING:2'),
  )
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(
    false,
  )
})

it('expires the session and clears all scoped cache and stream', async () => {
  const { client } = mount()
  const events = await source()
  act(() => events.emit('session.expired', { reason: 'session_required' }))
  await waitFor(() =>
    expect(screen.getByTestId('identity')).toBeEmptyDOMElement(),
  )
  expect(screen.getByTestId('tasks')).toBeEmptyDOMElement()
  expect(events.closed).toBe(true)
  expect(
    client.getQueryCache().findAll({ queryKey: ['server', session.user_id] }),
  ).toHaveLength(0)
})

it('preserves leading zeros, switches user, and refuses late events from the previous stream', async () => {
  const user = userEvent.setup()
  const { client } = mount()
  const previous = await source()
  await user.click(screen.getByRole('button', { name: '사용자 00427' }))
  await user.type(screen.getByLabelText('사용자 코드'), other.user_code)
  await user.click(screen.getByRole('button', { name: '사용자 전환' }))
  await waitFor(() =>
    expect(screen.getByTestId('identity')).toHaveTextContent('00008'),
  )
  act(() =>
    previous.emit('task.completed', { ...task, status: 'SUCCEEDED' }, 20),
  )
  expect(screen.getByTestId('tasks')).toBeEmptyDOMElement()
  expect(previous.closed).toBe(true)
  expect(
    client.getQueryCache().findAll({ queryKey: ['server', session.user_id] }),
  ).toHaveLength(0)
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/session',
    expect.objectContaining({
      method: 'POST',
      body: '{"user_code":"00008"}',
      credentials: 'same-origin',
    }),
  )
})

it('shows invalid-code errors without assigning an unissued user', async () => {
  active = null
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('button', { name: '코드로 접속' }))
  await user.type(screen.getByLabelText('사용자 코드'), '99999')
  await user.click(screen.getByRole('button', { name: '코드로 재접속' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '발급된 5자리 코드를 확인',
  )
  expect(screen.getByTestId('identity')).toBeEmptyDOMElement()
  expect(FakeSource.instances).toHaveLength(0)
})

it('shows rate limits and an explicit retry after a server outage', async () => {
  fetcher.mockImplementationOnce(async () =>
    json({ detail: 'database_unavailable' }, 503),
  )
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('button', { name: '코드로 접속' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    '서버가 준비되지 않았습니다',
  )
  await user.click(screen.getByRole('button', { name: '세션 다시 확인' }))
  await source()
  fetcher.mockImplementationOnce(
    async () =>
      new Response(JSON.stringify({ detail: 'entry_rate_limited' }), {
        status: 429,
        headers: { 'Retry-After': '60' },
      }),
  )
  await user.type(screen.getByLabelText('사용자 코드'), '99999')
  await user.click(screen.getByRole('button', { name: '사용자 전환' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('60초 후')
})

it('revalidates a failed SSE connection and drops an expired cookie', async () => {
  mount()
  const events = await source()
  active = null
  act(() => events.onerror?.())
  await waitFor(() =>
    expect(screen.getByTestId('identity')).toBeEmptyDOMElement(),
  )
  expect(events.closed).toBe(true)
})

it('keeps native reconnect on the same EventSource and retains the last known state', async () => {
  mount()
  const events = await source()
  act(() => {
    events.onopen?.()
    events.onerror?.()
  })
  await waitFor(() =>
    expect(screen.getByTestId('connection')).toHaveTextContent('reconnecting'),
  )
  expect(screen.getByTestId('tasks')).toHaveTextContent('QUEUED:1')
  expect(FakeSource.instances).toHaveLength(1)
  act(() => events.onopen?.())
  await waitFor(() =>
    expect(screen.getByTestId('connection')).toHaveTextContent('live'),
  )
})

it('does not resurrect a dismissed notification from a delayed REST response', () => {
  const acknowledged = {
    ...task,
    status: 'SUCCEEDED',
    state_version: 3,
    acknowledged: true,
  }
  expect(
    mergeTask([acknowledged], { ...acknowledged, acknowledged: false }),
  ).toEqual([acknowledged])
})

it('does not restore another user from a delayed task snapshot after switching', async () => {
  let resolveSnapshot!: (value: Response) => void
  const initialFetcher = fetcher.getMockImplementation()!
  let delayed = false
  fetcher.mockImplementation((url, init) => {
    if (String(url) === '/api/v1/me/tasks' && !delayed) {
      delayed = true
      return new Promise((resolve) => {
        resolveSnapshot = resolve
      })
    }
    return initialFetcher(url, init)
  })
  const user = userEvent.setup()
  const { client } = mount()
  await user.click(await screen.findByRole('button', { name: '사용자 00427' }))
  await user.type(screen.getByLabelText('사용자 코드'), other.user_code)
  await user.click(screen.getByRole('button', { name: '사용자 전환' }))
  await source()
  await act(async () =>
    resolveSnapshot(json({ tasks: [task], event_cursor: `${stream}:0` })),
  )
  expect(screen.getByTestId('identity')).toHaveTextContent('00008')
  expect(screen.getByTestId('tasks')).toBeEmptyDOMElement()
  expect(
    client.getQueryCache().findAll({ queryKey: ['server', session.user_id] }),
  ).toHaveLength(0)
})

it('refreshes on acknowledgement version conflict without dismissing a newer completion', async () => {
  snapshot = [{ ...task, status: 'SUCCEEDED', state_version: 3 }]
  const user = userEvent.setup()
  mount()
  const events = await source()
  await user.click(screen.getByRole('button', { name: /내 분석 작업/ }))
  const initialFetcher = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/acknowledgement')) {
      snapshot = [{ ...task, status: 'FAILED', state_version: 4 }]
      snapshotNumber = 4
      return json({ detail: 'terminal_version_conflict' }, 409)
    }
    return initialFetcher(url, init)
  })
  await user.click(screen.getByRole('button', { name: '종료 알림 확인' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('작업 상태가 변경')
  await waitFor(() =>
    expect(screen.getByTestId('tasks')).toHaveTextContent('FAILED:4'),
  )
  expect(screen.getByRole('button', { name: '종료 알림 확인' })).toBeVisible()
  expect(events.closed).toBe(true)
})

it('reuses the diagnostic key after a lost response and never inserts its stale REST payload', async () => {
  snapshot = []
  const user = userEvent.setup()
  mount()
  await source()
  await user.click(screen.getByRole('button', { name: /내 분석 작업/ }))
  const initialFetcher = fetcher.getMockImplementation()!
  let attempts = 0
  const bodies: string[] = []
  fetcher.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/diagnostics')) {
      bodies.push(String(init?.body))
      attempts += 1
      if (attempts === 1) throw new TypeError('network failure')
      // The task was already acknowledged in another tab before this old reply arrived.
      return json(task, 202)
    }
    return initialFetcher(url, init)
  })
  await user.click(screen.getByRole('button', { name: '연결 점검 실행' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '서버에 연결하지 못했습니다',
  )
  await user.click(screen.getByRole('button', { name: '연결 점검 실행' }))
  await waitFor(() => expect(FakeSource.instances).toHaveLength(2))
  expect(bodies[0]).toEqual(bodies[1])
  expect(screen.getByTestId('tasks')).toBeEmptyDOMElement()
})

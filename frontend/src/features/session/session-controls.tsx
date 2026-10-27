import { useState } from 'react'
import { Button } from '../../shared/components/button'
import { Modal } from '../../shared/components/modal'
import { useSession } from './session-context'

export function SessionControls() {
  const { session, phase, message, change, restore } = useSession()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const pending = phase === 'loading' || phase === 'changing'
  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        {pending
          ? '세션 확인 중'
          : session
            ? `사용자 ${session.user_code}`
            : '코드로 접속'}
      </Button>
      {message && !open && (
        <span className="session-message" role="status">
          {message}
        </span>
      )}
      <Modal
        title="사용자 접속"
        description="5자리 코드로 같은 사용자의 작업을 복원합니다. 발급된 코드를 보관해 주세요."
        open={open}
        onOpenChange={setOpen}
      >
        {session && (
          <p className="notice">
            현재 사용자 코드: <strong>{session.user_code}</strong>
          </p>
        )}
        <p>
          코드를 아는 사람은 같은 작업에 접근할 수 있습니다. 개인 예시 메모는 이
          브라우저에만 저장됩니다.
        </p>
        <form
          className="session-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (/^[0-9]{5}$/.test(code)) void change('login', code)
          }}
        >
          <label className="form-field">
            사용자 코드
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{5}"
              maxLength={5}
              placeholder="00427"
              required
              disabled={pending}
            />
          </label>
          <Button type="submit" disabled={pending || !/^[0-9]{5}$/.test(code)}>
            {session ? '사용자 전환' : '코드로 재접속'}
          </Button>
        </form>
        <div className="session-buttons">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setCode('')
              void change('create')
            }}
          >
            새 코드 발급
          </Button>
          {session && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setCode('')
                void change('logout')
              }}
            >
              로그아웃
            </Button>
          )}
          {phase === 'unavailable' && (
            <Button variant="ghost" onClick={() => void restore()}>
              세션 다시 확인
            </Button>
          )}
        </div>
        {pending && <p role="status">세션을 확인하고 있습니다.</p>}
        {message && <p role="alert">{message}</p>}
      </Modal>
    </>
  )
}

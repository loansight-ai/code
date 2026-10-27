# 프론트엔드 시작 도구 검증

> 2026-10-27 · Windows PowerShell 5.1 · Node.js 24.22.1 · pnpm 10.34.9

## 문제와 변경

이전 구현 검증에서 Node.js·pnpm은 임시 디렉터리에 설치되어 해당 검증 프로세스의 PATH에서만 사용할 수 있었다. 일반 터미널에서 `start.cmd`를 실행하면 `pnpm.cmd is not installed or not on PATH` 오류가 발생했다.

`setup-frontend.cmd`는 버전 파일에 맞는 프로젝트 전용 도구와 의존성을 `.tools/`에 준비한다. 시작 스크립트는 이 경로를 우선 사용하고, 선택한 Node.js·pnpm 디렉터리를 숨겨진 실행 프로세스의 PATH에도 전달한다. 누락·버전 오류에는 준비 명령을 안내한다. 설치·사용 절차는 [프론트엔드 실행 안내](../../frontend/README.md#실행)에서 관리한다.

## 검증 결과

| 검증 방법 | 기대 결과 | 실제 결과 |
| --- | --- | --- |
| `python -m unittest discover -s scripts/tests -v` | 옵션·프로세스 관리·도구 탐색 테스트 통과 | 8개 통과 |
| Node.js·pnpm이 없는 PATH에서 시작 | 자동 실행 실패와 명시적 준비 명령 안내 | `setup-frontend.cmd` 안내, 관리 프로세스 미생성 |
| PATH에 pnpm이 없고 프로젝트 전용 pnpm이 있는 격리 fixture | 로컬 도구로 시작·종료 가능 | 성공, 경로의 공백 포함 |
| 잘못된 Node.js·pnpm 버전 fixture | 프로세스 시작 전 오류 안내 | Node.js 24와 pnpm 10.34.9 요구 안내 |
| 실제 `setup-frontend.cmd` | Node 공식 SHA-256 일치, 고정 pnpm·의존성 준비 | 성공, lockfile 변경 없음 |
| PATH 도구 추가 없이 실제 `start.cmd --frontend` | 프로젝트 전용 도구로 Vite 시작 | `http://localhost:5173` HTTP 200 |
| 실제 시작 명령 반복 | 기존 관리 프로세스 유지 | Already running, 상태 파일 동일 |
| 실제 `start.cmd --frontend --restart` | 관리 프로세스 교체 후 준비 | 성공, HTTP 200 |
| 실제 `stop.cmd --frontend` 두 번 | 소유 프로세스 종료 후 멱등 안내 | Stopped / Already stopped |
| 준비 명령 재실행 후 시작 | 기존 도구 재사용, 의존성 유지, 기동 | Already up to date, HTTP 200 |

격리 fixture는 실제 앱 대신 Python HTTP 서버를 사용한다. 실제 Vite 검증은 별도로 수행했다. 기존에 이 작업에서 수동 실행한 개발 서버만 종료하여 관리 스크립트 실행으로 전환했고, 다른 프로세스가 사용하는 포트를 자동 종료하는 동작은 추가하지 않았다. 검증 후 프론트엔드는 실행 상태로 두었다.

이번 변경은 Windows 시작 도구에 한정한다. 백엔드 코드는 변경하지 않았으며 Docker/DB/MQ 통합 검사와 프론트엔드 업무 화면 테스트는 다시 실행하지 않았다.

# Redis 설치 및 실행 가이드 (For Developers)

이 프로젝트(`krafton-jungle-eum`)의 **실시간 상태 기능(Status Feature)**은 Redis를 필수적으로 사용합니다. 백엔드 서버를 실행하기 전에 반드시 Redis가 로컬에서 실행 중이어야 합니다.

## 1. 설치 방법 (OS별)

### Windows 사용자
Windows에서는 **WSL2** (Windows Subsystem for Linux)를 사용하거나 **Docker**를 사용하는 것이 가장 호환성이 좋습니다.

#### 방법 A: Docker 사용 (권장)
Docker Desktop이 설치되어 있다면 가장 간편합니다.
```bash
# Redis 컨테이너 실행 (기본 포트 6379)
docker run --name my-redis -p 6379:6379 -d redis
```

#### 방법 B: WSL2 (Ubuntu) 사용
1.  WSL 터미널 열기
2.  설치:
    ```bash
    sudo apt-get update
    sudo apt-get install redis-server
    ```
3.  실행:
    ```bash
    sudo service redis-server start
    ```

### Mac 사용자 (Homebrew)
```bash
# 설치
brew install redis

# 서비스 실행 (백그라운드)
brew services start redis

# 또는 일회성 실행
redis-server
```

## 2. 실행 확인
설치 후 터미널(또는 CMD)에서 다음 명령어를 입력했을 때 `PONG`이 나와야 합니다.

```bash
redis-cli ping
# 응답: PONG
```

## 3. 프로젝트 환경 변수 설정 (.env)
백엔드(`backend/.env` 또는 환경변수)에 다음 설정이 있는지 확인하세요. (로컬 기본값은 설정 안 해도 작동하지만 명시하는 것이 좋습니다.)

```env
REDIS_ADDR=localhost:6379
REDIS_PASSWORD=           # 비밀번호가 없다면 비워두기
REDIS_DB=0
```

---
**문제 해결**:
*   `connection refused` 에러가 나면 Redis가 실행 중인지 확인하세요.
*   WSL을 사용하는 경우, 윈도우에서 `localhost:6379`로 접근이 안 될 수도 있습니다. 이 경우 Docker를 사용하는 것이 정신 건강에 이롭습니다.

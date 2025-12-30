# ================================
# Stage 1: Build
# ================================
FROM golang:1.25-alpine AS builder

# 빌드에 필요한 도구 설치
RUN apk add --no-cache git ca-certificates tzdata

# 작업 디렉토리 설정
WORKDIR /app

# 의존성 먼저 복사 (캐시 활용)
COPY go.mod go.sum ./
RUN go mod download

# 소스 코드 복사
COPY . .

# 바이너리 빌드 (CGO 비활성화로 정적 바이너리 생성)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o /app/server \
    ./cmd/server

# ================================
# Stage 2: Runtime
# ================================
FROM alpine:3.19

# 런타임에 필요한 패키지만 설치
RUN apk add --no-cache ca-certificates tzdata

# 타임존 설정
ENV TZ=Asia/Seoul

# 비루트 사용자 생성 (보안)
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# 작업 디렉토리 설정
WORKDIR /app

# 빌드된 바이너리 복사
COPY --from=builder /app/server .

# 소유권 변경
RUN chown -R appuser:appgroup /app

# 비루트 사용자로 전환
USER appuser

# 포트 노출
EXPOSE 8080

# 헬스체크
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# 서버 실행
CMD ["./server"]

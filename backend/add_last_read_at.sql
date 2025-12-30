-- participants 테이블에 last_read_at 컬럼 추가
ALTER TABLE participants ADD COLUMN last_read_at TIMESTAMP;

-- 기존 참가자들의 last_read_at을 현재 시간으로 초기화 (선택사항)
UPDATE participants SET last_read_at = NOW() WHERE last_read_at IS NULL;

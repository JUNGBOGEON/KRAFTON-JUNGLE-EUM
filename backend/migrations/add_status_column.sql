-- =====================================================
-- 워크스페이스 멤버 Status 컬럼 추가/수정 마이그레이션
-- =====================================================

-- 1. Status 컬럼이 없으면 추가
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'workspace_members' 
        AND column_name = 'status'
    ) THEN
        ALTER TABLE workspace_members 
        ADD COLUMN status VARCHAR(20) DEFAULT 'ACTIVE';
        
        RAISE NOTICE 'Status column added successfully';
    ELSE
        RAISE NOTICE 'Status column already exists';
    END IF;
END $$;

-- 2. 기존 NULL 값을 ACTIVE로 업데이트
UPDATE workspace_members 
SET status = 'ACTIVE' 
WHERE status IS NULL;

-- 3. NOT NULL 제약조건 추가 (선택사항)
-- ALTER TABLE workspace_members 
-- ALTER COLUMN status SET NOT NULL;

-- 4. 결과 확인
SELECT 
    column_name, 
    data_type, 
    column_default, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'workspace_members' 
AND column_name = 'status';

-- 5. 데이터 확인
SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active,
    COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
    COUNT(CASE WHEN status IS NULL THEN 1 END) as null_status
FROM workspace_members;

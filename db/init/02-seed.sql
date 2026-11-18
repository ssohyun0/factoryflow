-- ============================================================
-- 02-seed.sql : 시드 데이터 (사용자 2명, 자재 12종, 트리 3종, BOM, 초기 재고)
--
-- 값은 화면 시안과 같다. 솔방울(PINECONE)과 눈꽃 장식(SNOW)은
-- 처음부터 안전재고 미달 상태로 두어 대시보드의 '부족/위험' 표시를 바로 볼 수 있게 한다.
-- 01-schema.sql 다음에 실행된다 (파일 이름 순서).
-- ============================================================
USE erp_inventory;

-- ------------------------------------------------------------
-- 사용자 (시연용 공개 계정)
--   santa    / santa123    : ADMIN  (산타 · 생산관리자)
--   reindeer / reindeer123 : WORKER (루돌프 · 현장 작업자)
-- password_hash는 bcrypt(cost 10) 결과이며 PHP password_verify()로 검증한다.
-- ------------------------------------------------------------
INSERT INTO users (username, password_hash, display_name, role) VALUES
  ('santa',    '$2y$10$QwcAqU5K6C8FxCpomyxzjedyEypeWNeZcN7t4SxVOTE/qqxtdXzQe', '산타',   'ADMIN'),
  ('reindeer', '$2y$10$ibrZTYIHtP7JhjoMsKHil.RX27qt1EjhtB2QrjoEE.dHOtEZ1Us6y', '루돌프', 'WORKER');

-- ------------------------------------------------------------
-- 품목: 자재(오너먼트) 12종
-- ------------------------------------------------------------
INSERT INTO items (code, name, short_name, kind, safety_stock, sort_order) VALUES
  ('FIR-150',   '전나무 150cm',     NULL, 'MAT', 20,  1),
  ('FIR-60',    '미니 전나무 60cm', NULL, 'MAT', 30,  2),
  ('BALL-RED',  '빨간 볼',          NULL, 'MAT', 100, 3),
  ('BALL-GOLD', '금색 볼',          NULL, 'MAT', 60,  4),
  ('MINI-BALL', '미니 볼',          NULL, 'MAT', 100, 5),
  ('STAR-GOLD', '금색 별',          NULL, 'MAT', 10,  6),
  ('STAR-SLV',  '은색 별',          NULL, 'MAT', 10,  7),
  ('SNOW',      '눈꽃 장식',        NULL, 'MAT', 50,  8),
  ('LIGHT',     'LED 전구줄 5m',    NULL, 'MAT', 15,  9),
  ('GINGER',    '진저브레드맨',     NULL, 'MAT', 20,  10),
  ('RIBBON',    '벨벳 리본',        NULL, 'MAT', 30,  11),
  ('PINECONE',  '솔방울',           NULL, 'MAT', 20,  12);

-- ------------------------------------------------------------
-- 품목: 완성 트리 3종 (안전재고 개념 없음 → 0)
-- ------------------------------------------------------------
INSERT INTO items (code, name, short_name, kind, safety_stock, sort_order) VALUES
  ('T-CLASSIC', '클래식 레드 트리',   '레드 트리',          'TREE', 0, 101),
  ('T-SNOW',    '스노우 화이트 트리', '스노우 화이트 트리', 'TREE', 0, 102),
  ('T-MINI',    '미니 탁상 트리',     '미니 트리',          'TREE', 0, 103);

-- ------------------------------------------------------------
-- BOM (트리 1그루당 소요량, 고정)
-- ------------------------------------------------------------
INSERT INTO bom_lines (tree_code, item_code, qty_per_tree) VALUES
  -- 클래식 레드 트리
  ('T-CLASSIC', 'FIR-150',   1),
  ('T-CLASSIC', 'BALL-RED',  12),
  ('T-CLASSIC', 'STAR-GOLD', 1),
  ('T-CLASSIC', 'LIGHT',     1),
  ('T-CLASSIC', 'RIBBON',    4),
  -- 스노우 화이트 트리
  ('T-SNOW',    'FIR-150',   1),
  ('T-SNOW',    'SNOW',      10),
  ('T-SNOW',    'STAR-SLV',  1),
  ('T-SNOW',    'LIGHT',     1),
  ('T-SNOW',    'BALL-GOLD', 6),
  -- 미니 탁상 트리
  ('T-MINI',    'FIR-60',    1),
  ('T-MINI',    'MINI-BALL', 6),
  ('T-MINI',    'RIBBON',    2),
  ('T-MINI',    'PINECONE',  1);

-- ------------------------------------------------------------
-- 초기 재고
-- ------------------------------------------------------------
INSERT INTO stock (item_code, qty) VALUES
  ('FIR-150',   40),
  ('FIR-60',    60),
  ('BALL-RED',  240),
  ('BALL-GOLD', 80),
  ('MINI-BALL', 300),
  ('STAR-GOLD', 12),
  ('STAR-SLV',  18),
  ('SNOW',      30),   -- 안전재고 50 미달 → '부족'
  ('LIGHT',     25),
  ('GINGER',    36),
  ('RIBBON',    44),
  ('PINECONE',  8),    -- 안전재고 20의 절반 미만 → '위험'
  ('T-CLASSIC', 6),
  ('T-SNOW',    2),
  ('T-MINI',    14);

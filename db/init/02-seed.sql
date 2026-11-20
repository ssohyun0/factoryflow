-- ============================================================
-- 02-seed.sql : 시드 데이터 (사용자 2명, 자재 12종, 트리 3종, BOM, 초기 재고)
--
-- 초기 재고: 자재는 모두 안전재고 × 2(전부 '정상'), 완성 트리는 0.
-- 작업지시·생산계획·출하·수불 이력은 비어 있는 상태로 시작한다 (대시보드 KPI 모두 0).
-- (2026-11-20 사용자 요청으로 시안 값에서 변경)
-- 01-schema.sql 다음에 실행된다 (파일 이름 순서).
-- ============================================================
-- 접속 문자셋을 utf8mb4로 지정한다. 이 줄이 없으면 초기화 스크립트를 실행하는 클라이언트가
-- 한글(UTF-8)을 latin1로 잘못 해석해 저장하고, PHP(utf8mb4)로 읽을 때 글자가 깨진다.
SET NAMES utf8mb4;

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
-- 초기 재고: 자재 = 안전재고 × 2, 완성 트리 = 0
-- ------------------------------------------------------------
INSERT INTO stock (item_code, qty) VALUES
  ('FIR-150',   40),    -- 안전재고 20
  ('FIR-60',    60),    -- 안전재고 30
  ('BALL-RED',  200),   -- 안전재고 100
  ('BALL-GOLD', 120),   -- 안전재고 60
  ('MINI-BALL', 200),   -- 안전재고 100
  ('STAR-GOLD', 20),    -- 안전재고 10
  ('STAR-SLV',  20),    -- 안전재고 10
  ('SNOW',      100),   -- 안전재고 50
  ('LIGHT',     30),    -- 안전재고 15
  ('GINGER',    40),    -- 안전재고 20
  ('RIBBON',    60),    -- 안전재고 30
  ('PINECONE',  40),    -- 안전재고 20
  ('T-CLASSIC', 0),
  ('T-SNOW',    0),
  ('T-MINI',    0);

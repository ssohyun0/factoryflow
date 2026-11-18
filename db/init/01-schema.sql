-- ============================================================
-- 01-schema.sql : 스키마, 테이블, 서비스별 DB 계정 생성
--
-- 마이크로서비스마다 자기 스키마만 소유한다.
--   erp_inventory  : 재고 서버(PHP, erp-inventory-api) 소유
--                    사용자·품목·BOM·재고·수불 이력
--   erp_production : 생산 서버(FastAPI, erp-production-api-1~3) 소유
--                    생산계획·작업지시·출하
-- 다른 서비스의 데이터는 DB로 직접 읽지 않고 API로만 접근한다.
-- 그래서 두 스키마 사이에는 외래키를 두지 않고 user_id, tree_code 값만 저장한다.
--
-- 실행 방식: 공식 mysql:8.0 이미지를 그대로 쓰고, 이 폴더(db/init)를
--   docker run -v $HOME/factoryflow/db/init:/docker-entrypoint-initdb.d:ro
-- 로 연결한다. MySQL 컨테이너가 빈 볼륨(erp-mysql-data)으로 처음 시작될 때
-- 파일 이름 순서(01 → 02)대로 한 번만 실행된다. 이미 데이터가 있으면 다시 실행되지 않는다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. erp_inventory (재고 서버 소유)
-- ------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS erp_inventory
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE erp_inventory;

-- 로그인 사용자. 비밀번호는 bcrypt 해시(password_hash)로만 저장한다.
CREATE TABLE users (
  id            INT          NOT NULL AUTO_INCREMENT,
  username      VARCHAR(30)  NOT NULL,                 -- 로그인 아이디 (santa, reindeer)
  password_hash VARCHAR(255) NOT NULL,                 -- PHP password_hash() 결과
  display_name  VARCHAR(50)  NOT NULL,                 -- 화면 표시 이름 (산타, 루돌프)
  role          ENUM('ADMIN', 'WORKER') NOT NULL,      -- ADMIN=생산관리자, WORKER=현장 작업자
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;

-- 품목: 자재(오너먼트, MAT)와 완성 트리(TREE)를 한 테이블에서 관리한다.
CREATE TABLE items (
  code         VARCHAR(20) NOT NULL,                   -- 품목 코드 (예: FIR-150, T-CLASSIC)
  name         VARCHAR(50) NOT NULL,                   -- 정식 이름 (예: 클래식 레드 트리)
  short_name   VARCHAR(30) NULL,                       -- 대시보드 요약용 짧은 이름 (트리만 사용)
  kind         ENUM('MAT', 'TREE') NOT NULL,           -- MAT=자재, TREE=완성 트리
  safety_stock INT         NOT NULL DEFAULT 0,         -- 안전재고 (이보다 적으면 '부족' 표시)
  sort_order   INT         NOT NULL DEFAULT 0,         -- 화면 표시 순서
  PRIMARY KEY (code)
) ENGINE=InnoDB;

-- BOM(자재명세서): 트리 1그루를 만들 때 필요한 자재와 수량. 값은 고정이다.
CREATE TABLE bom_lines (
  tree_code    VARCHAR(20) NOT NULL,                   -- 완성 트리 코드
  item_code    VARCHAR(20) NOT NULL,                   -- 들어가는 자재 코드
  qty_per_tree INT         NOT NULL,                   -- 1그루당 소요량
  PRIMARY KEY (tree_code, item_code),
  CONSTRAINT fk_bom_tree FOREIGN KEY (tree_code) REFERENCES items (code),
  CONSTRAINT fk_bom_item FOREIGN KEY (item_code) REFERENCES items (code),
  CONSTRAINT ck_bom_qty  CHECK (qty_per_tree > 0)
) ENGINE=InnoDB;

-- 현재 재고. 품목마다 한 행이며, 음수가 되지 않도록 CHECK 제약을 둔다.
-- (차감 로직은 트랜잭션 + SELECT ... FOR UPDATE로 먼저 확인하고, 이 제약은 마지막 안전장치다)
CREATE TABLE stock (
  item_code  VARCHAR(20) NOT NULL,
  qty        INT         NOT NULL DEFAULT 0,
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (item_code),
  CONSTRAINT fk_stock_item FOREIGN KEY (item_code) REFERENCES items (code),
  CONSTRAINT ck_stock_qty  CHECK (qty >= 0)
) ENGINE=InnoDB;

-- 수불 이력: 재고가 바뀔 때마다 한 행씩 쌓는다 (누가, 언제, 왜).
--   RECEIPT = 자재 입고 (+)        CONSUME = 생산 투입, 자재 차감 (-)
--   PRODUCE = 생산 입고, 트리 (+)  SHIP    = 출하, 트리 차감 (-)
CREATE TABLE stock_transactions (
  id            BIGINT      NOT NULL AUTO_INCREMENT,
  item_code     VARCHAR(20) NOT NULL,
  type          ENUM('RECEIPT', 'CONSUME', 'PRODUCE', 'SHIP') NOT NULL,
  qty           INT         NOT NULL,                  -- 증감량 (입고 +, 차감 -)
  balance_after INT         NOT NULL,                  -- 처리 후 재고 (이력만 보고도 추적 가능)
  user_id       INT         NOT NULL,                  -- 처리자 (세션에서 꺼낸 사용자 ID)
  ref_no        VARCHAR(30) NULL,                      -- 관련 작업지시 번호 (예: WO-1201-001)
  memo          VARCHAR(100) NULL,                     -- 공급처, 출하처 등
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_tx_created (created_at),
  KEY ix_tx_item (item_code),
  CONSTRAINT fk_tx_item FOREIGN KEY (item_code) REFERENCES items (code),
  CONSTRAINT fk_tx_user FOREIGN KEY (user_id)   REFERENCES users (id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 2. erp_production (생산 서버 소유)
-- ------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS erp_production
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE erp_production;

-- 생산계획: 산타가 [작업지시 일괄 등록]을 누를 때마다 1건. 하루에 여러 번 가능하다.
CREATE TABLE production_plans (
  id               INT         NOT NULL AUTO_INCREMENT,
  created_by       INT         NOT NULL,               -- 등록자 user_id (erp_inventory.users.id 값)
  created_by_name  VARCHAR(30) NOT NULL,               -- 등록자 username (다른 스키마를 조회하지 않고 표시)
  created_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- 생산계획의 줄: 모델별 주문 수량과 실제 계획 수량
CREATE TABLE plan_lines (
  id        INT         NOT NULL AUTO_INCREMENT,
  plan_id   INT         NOT NULL,
  tree_code VARCHAR(20) NOT NULL,                      -- 트리 모델 코드 (erp_inventory.items.code 값)
  order_qty INT         NOT NULL,                      -- 트리 모델 탭에서 담은 주문 수량
  plan_qty  INT         NOT NULL,                      -- 생산계획 화면에서 확정한 수량
  PRIMARY KEY (id),
  CONSTRAINT fk_line_plan FOREIGN KEY (plan_id) REFERENCES production_plans (id)
) ENGINE=InnoDB;

-- 작업지시: 같은 모델의 WAIT 작업지시가 있으면 새로 만들지 않고 qty를 더한다.
CREATE TABLE work_orders (
  id                 INT         NOT NULL AUTO_INCREMENT,
  wo_no              VARCHAR(20) NOT NULL,             -- 작업지시 번호 (예: WO-1201-001 = 12월 1일 1번)
  tree_code          VARCHAR(20) NOT NULL,
  qty                INT         NOT NULL,
  status             ENUM('WAIT', 'DONE') NOT NULL DEFAULT 'WAIT',
  shipped            TINYINT(1)  NOT NULL DEFAULT 0,   -- 완료 후 출하했는지 (1=출하됨)
  created_by         INT         NOT NULL,
  created_by_name    VARCHAR(30) NOT NULL,
  created_at         DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_by       INT         NULL,                 -- 완료 처리한 작업자 user_id
  completed_by_name  VARCHAR(30) NULL,
  completed_server   VARCHAR(50) NULL,                 -- 완료를 처리한 생산 서버 hostname (분산 증명)
  completed_at       DATETIME    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wo_no (wo_no),
  KEY ix_wo_status (status, tree_code),
  CONSTRAINT ck_wo_qty CHECK (qty > 0)
) ENGINE=InnoDB;

-- 출하 기록: 출하 작업서의 한 줄 = 한 행
CREATE TABLE shipments (
  id              INT         NOT NULL AUTO_INCREMENT,
  tree_code       VARCHAR(20) NOT NULL,
  destination     VARCHAR(50) NOT NULL,                -- 출하처 (예: 강남 물류센터)
  qty             INT         NOT NULL,
  shipped_by      INT         NOT NULL,
  shipped_by_name VARCHAR(30) NOT NULL,
  shipped_server  VARCHAR(50) NOT NULL,                -- 출하를 처리한 생산 서버 hostname
  shipped_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT ck_ship_qty CHECK (qty > 0)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 3. 서비스별 DB 계정 (최소 권한)
--   각 서버는 자기 스키마에만 접근할 수 있다. 비밀번호는 시연용 공개 기본값이며
--   docker run의 환경변수(DB_PASSWORD)와 같아야 한다.
-- ------------------------------------------------------------
CREATE USER 'inventory_app'@'%'  IDENTIFIED BY 'inventory_pw';
CREATE USER 'production_app'@'%' IDENTIFIED BY 'production_pw';

GRANT SELECT, INSERT, UPDATE, DELETE ON erp_inventory.*  TO 'inventory_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON erp_production.* TO 'production_app'@'%';
FLUSH PRIVILEGES;

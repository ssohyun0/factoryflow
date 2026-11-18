<?php
/**
 * config.php
 * ------------------------------------------------------------
 * 역할 : 환경변수에서 설정값을 읽어 상수로 정의한다.
 *        docker run -e 옵션으로 값을 바꿀 수 있고, 없으면 시연용 기본값을 쓴다.
 * 사용 : public/index.php 가 가장 먼저 require 한다.
 * 주의 : 기본 비밀번호는 시연용 공개 값이다 (db/init/01-schema.sql 의 계정과 같아야 함).
 * ------------------------------------------------------------
 */

declare(strict_types=1);

/**
 * 환경변수를 읽고, 없으면 기본값을 돌려준다.
 *
 * @param string $name    환경변수 이름
 * @param string $default 환경변수가 없을 때 쓸 값
 * @return string
 */
function env(string $name, string $default): string
{
    $value = getenv($name);
    return ($value === false || $value === '') ? $default : $value;
}

// MySQL 접속 정보 (컨테이너 이름 erp-mysql 로 erp-net 안에서 접속)
define('DB_HOST', env('DB_HOST', 'erp-mysql'));
define('DB_PORT', (int) env('DB_PORT', '3306'));
define('DB_NAME', env('DB_NAME', 'erp_inventory'));
define('DB_USER', env('DB_USER', 'inventory_app'));
define('DB_PASSWORD', env('DB_PASSWORD', 'inventory_pw'));

// Redis 접속 정보 (세션 공유 저장소)
define('REDIS_HOST', env('REDIS_HOST', 'erp-redis'));
define('REDIS_PORT', (int) env('REDIS_PORT', '6379'));

// 세션 설정 — FastAPI 쪽 설정과 반드시 같아야 세션이 공유된다
define('SESSION_NAME', env('SESSION_NAME', 'FFSESSID'));    // 쿠키 이름
define('SESSION_KEY_PREFIX', 'session:');                    // Redis 키 접두사 (실습과 동일)
define('SESSION_TTL', (int) env('SESSION_TTL', '3600'));    // 유효시간(초)

// 생산 서버 → 재고 서버 내부 API 호출에 쓰는 공유 비밀값 (X-Internal-Token 헤더)
define('INTERNAL_TOKEN', env('INTERNAL_TOKEN', 'factoryflow-internal'));

// 응답의 servedBy 에 넣을 컨테이너 이름 (docker run --hostname 값)
define('SERVED_BY', gethostname() ?: 'erp-inventory-api');

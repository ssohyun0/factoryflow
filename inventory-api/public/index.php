<?php
/**
 * index.php — erp-inventory-api 의 유일한 진입점(라우터)
 * ------------------------------------------------------------
 * Apache 설정(FallbackResource)으로 모든 요청이 이 파일로 들어온다.
 * "HTTP 메서드 + 경로"를 라우트 표에서 찾아 해당 Controller 함수를 호출하고,
 * 처리 중 발생한 ApiException 은 공통 실패 응답(JSON)으로 바꾼다.
 *
 * 경로 구분
 *   /api/auth/*        로그인·로그아웃 (erp-proxy 를 거쳐 브라우저가 호출)
 *   /api/inventory/*   재고 서비스 API (erp-proxy 를 거쳐 브라우저가 호출)
 *   /internal/*        생산 서버 전용 내부 API (erp-net 안에서만 호출, 프록시는 외부 접근 차단)
 * ------------------------------------------------------------
 */

declare(strict_types=1);

// 소스는 웹 루트 밖(/var/www/src)에 있어 브라우저가 직접 열 수 없다
$src = dirname(__DIR__) . '/src';
require $src . '/config.php';
require $src . '/Http.php';
require $src . '/Db.php';
require $src . '/RedisSessionHandler.php';
require $src . '/Session.php';
require $src . '/AuthController.php';
require $src . '/StockService.php';
require $src . '/InventoryController.php';

/**
 * 라우트 표: [메서드, 경로] => [클래스, 정적 메서드]
 */
$routes = [
    // 인증·세션
    'POST /api/auth/login'             => [AuthController::class, 'login'],
    'POST /api/auth/logout'            => [AuthController::class, 'logout'],
    'GET /api/inventory/session'       => [AuthController::class, 'session'],
    // 재고 조회·입고 (화면용)
    'GET /api/inventory/items'         => [InventoryController::class, 'items'],
    'GET /api/inventory/models'        => [InventoryController::class, 'models'],
    'GET /api/inventory/transactions'  => [InventoryController::class, 'transactions'],
    'POST /api/inventory/receipts'     => [InventoryController::class, 'receipt'],
];

$method = $_SERVER['REQUEST_METHOD'];
$path   = rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/', '/') ?: '/';

try {
    $handler = $routes[$method . ' ' . $path] ?? null;
    if ($handler === null) {
        throw new ApiException(404, 'NOT_FOUND', "요청한 API가 없습니다: {$method} {$path}");
    }
    call_user_func($handler);
} catch (ApiException $e) {
    Http::fail($e);
} catch (Throwable $e) {
    // 예상하지 못한 오류: 내용은 로그(docker logs erp-inventory-api)에만 남기고 사용자에게는 일반 메시지
    error_log('[Unhandled] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Http::fail(new ApiException(500, 'INTERNAL_ERROR', '서버 내부 오류가 발생했습니다.'));
}

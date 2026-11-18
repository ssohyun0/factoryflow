<?php
/**
 * Session.php
 * ------------------------------------------------------------
 * 역할 : Redis 세션을 시작하고, 로그인 사용자와 권한(ADMIN/WORKER)을 확인한다.
 * 사용 : 각 Controller 의 첫 줄에서 Session::requireUser() 등을 호출한다.
 *
 * $_SESSION 에 저장하는 값 (FastAPI 도 같은 이름으로 읽는다)
 *   userId      int     erp_inventory.users.id
 *   username    string  로그인 아이디 (santa, reindeer)
 *   displayName string  화면 이름 (산타, 루돌프)
 *   role        string  ADMIN | WORKER
 *   loginAt     string  로그인 시각 (Y-m-d H:i:s)
 * ------------------------------------------------------------
 */

declare(strict_types=1);

final class Session
{
    /** 이번 요청에서 이미 세션을 시작했는지 */
    private static bool $started = false;

    /**
     * Redis 저장소로 PHP 세션을 시작한다. 여러 번 호출해도 한 번만 시작한다.
     */
    public static function start(): void
    {
        if (self::$started) {
            return;
        }
        session_name(SESSION_NAME);                                    // 쿠키 이름 FFSESSID (FastAPI 와 같아야 함)
        session_set_save_handler(new RedisSessionHandler(), true);     // 저장소를 Redis 로 교체
        session_start();
        self::$started = true;
    }

    /**
     * 로그인한 사용자 정보를 돌려준다. 로그인하지 않았으면 null.
     *
     * @return array{userId:int, username:string, displayName:string, role:string, loginAt:string}|null
     */
    public static function user(): ?array
    {
        // 세션 쿠키가 아예 없으면 로그인하지 않은 것이 확실하다.
        // 이때 session_start() 를 하면 빈 세션이 Redis 에 쌓이므로 시작하지 않는다.
        if (!self::$started && empty($_COOKIE[SESSION_NAME])) {
            return null;
        }
        self::start();
        if (empty($_SESSION['userId'])) {
            return null;
        }
        return [
            'userId'      => (int) $_SESSION['userId'],
            'username'    => (string) $_SESSION['username'],
            'displayName' => (string) $_SESSION['displayName'],
            'role'        => (string) $_SESSION['role'],
            'loginAt'     => (string) $_SESSION['loginAt'],
        ];
    }

    /**
     * 로그인과 (필요하면) 역할을 확인한다.
     *
     * @param string|null $role 'ADMIN' 또는 'WORKER'. null 이면 로그인만 확인
     * @return array 로그인 사용자 정보
     * @throws ApiException 401 — 로그인하지 않았거나 세션이 만료됨
     * @throws ApiException 403 — 역할이 맞지 않음 (예: 루돌프가 입고 API 호출)
     */
    public static function requireUser(?string $role = null): array
    {
        $user = self::user();
        if ($user === null) {
            throw new ApiException(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
        }
        if ($role !== null && $user['role'] !== $role) {
            throw new ApiException(403, 'FORBIDDEN', '이 기능을 사용할 권한이 없습니다.');
        }
        return $user;
    }

    /**
     * 로그인 처리: 세션 ID 를 새로 발급하고 사용자 정보를 세션에 저장한다.
     *
     * @param array $row users 테이블의 행
     */
    public static function login(array $row): void
    {
        self::start();
        // 로그인 전 세션 ID 를 버리고 새 ID 를 발급한다 (세션 고정 공격 방지).
        // true 를 주면 이전 ID 의 Redis 키도 destroy() 로 지운다.
        session_regenerate_id(true);
        $_SESSION['userId']      = (int) $row['id'];
        $_SESSION['username']    = $row['username'];
        $_SESSION['displayName'] = $row['display_name'];
        $_SESSION['role']        = $row['role'];
        $_SESSION['loginAt']     = date('Y-m-d H:i:s');
    }

    /**
     * 로그아웃 처리: Redis 의 세션 키를 지우고 브라우저 쿠키도 만료시킨다.
     * 이후에는 FastAPI 도 같은 쿠키로 세션을 찾지 못해 401 을 돌려준다.
     */
    public static function logout(): void
    {
        if (empty($_COOKIE[SESSION_NAME])) {
            return;                          // 세션 쿠키가 없으면 지울 세션도 없다
        }
        self::start();
        $_SESSION = [];
        $params = session_get_cookie_params();
        setcookie(SESSION_NAME, '', [
            'expires'  => time() - 3600,     // 과거 시각 = 즉시 삭제
            'path'     => $params['path'],
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_destroy();                   // RedisSessionHandler::destroy() 호출 → DEL session:<id>
    }

    /** 현재 세션 ID (세션 확인 패널에 표시) */
    public static function id(): string
    {
        self::start();
        return session_id();
    }
}

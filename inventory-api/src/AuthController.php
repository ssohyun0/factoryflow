<?php
/**
 * AuthController.php
 * ------------------------------------------------------------
 * 역할 : 로그인, 로그아웃, 세션 확인 API.
 *
 *   POST /api/auth/login         아이디·비밀번호 검증 → Redis 세션 생성 → FFSESSID 쿠키 발급
 *   POST /api/auth/logout        Redis 세션 삭제 + 쿠키 만료
 *   GET  /api/inventory/session  현재 세션 정보 + 응답한 컨테이너(servedBy)
 *                                → 생산 서버의 /api/production/session 과 비교해 세션 공유를 증명한다
 * ------------------------------------------------------------
 */

declare(strict_types=1);

final class AuthController
{
    /**
     * 로그인.
     * 요청 : { "username": "santa", "password": "santa123" }
     * 응답 : { userId, username, displayName, role, loginAt, sessionId }
     *
     * @throws ApiException 400 — 입력 누락
     * @throws ApiException 401 — 아이디 또는 비밀번호 불일치 (어느 쪽이 틀렸는지는 알려주지 않음)
     */
    public static function login(): void
    {
        $body = Http::body();
        $username = trim((string) ($body['username'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        if ($username === '' || $password === '') {
            throw new ApiException(400, 'VALIDATION_ERROR', '아이디와 비밀번호를 입력하세요.');
        }

        // 사용자 조회 (Prepared Statement)
        $row = Db::fetchOne(
            'SELECT id, username, password_hash, display_name, role FROM users WHERE username = ?',
            [$username]
        );

        // 비밀번호는 bcrypt 해시와 비교한다 (평문 저장·비교 금지)
        if ($row === null || !password_verify($password, $row['password_hash'])) {
            throw new ApiException(401, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.');
        }

        Session::login($row);
        Http::ok(Session::user() + ['sessionId' => Session::id()]);
    }

    /**
     * 로그아웃. 로그인하지 않은 상태에서 호출해도 성공으로 응답한다.
     */
    public static function logout(): void
    {
        Session::logout();
        Http::ok(['loggedOut' => true]);
    }

    /**
     * 세션 확인 (세션 공유 증명용).
     * 응답 : { sessionId, userId, username, displayName, role, loginAt, server: "PHP 8.1" }
     *
     * @throws ApiException 401 — 로그인하지 않음
     */
    public static function session(): void
    {
        $user = Session::requireUser();
        Http::ok(['sessionId' => Session::id()] + $user + ['server' => 'PHP ' . PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION]);
    }
}

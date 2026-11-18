<?php
/**
 * RedisSessionHandler.php
 * ------------------------------------------------------------
 * 역할 : PHP 기본 세션($_SESSION)의 저장소를 파일 대신 Redis(erp-redis)로 바꾼다.
 *        (수업 실습 8·10번의 session_set_save_handler 방식과 같다)
 *
 * 저장 형식
 *   키   : session:<세션ID>                (실습과 같은 접두사)
 *   값   : PHP 기본 직렬화 문자열          예) userId|i:1;username|s:5:"santa";role|s:5:"ADMIN";
 *   만료 : SESSION_TTL(3600초). 요청이 올 때마다 다시 늘어난다(슬라이딩 만료).
 *
 * 이기종 공유
 *   FastAPI(erp-production-api-1~3)가 같은 쿠키(FFSESSID)로 같은 키를 읽고,
 *   위 직렬화 문자열을 직접 해석한다. 그래서 PHP 로그인 한 번으로 두 서버가 같은 사용자를 안다.
 *
 * 사용 : Session::start() 가 session_set_save_handler() 로 등록한다.
 * ------------------------------------------------------------
 */

declare(strict_types=1);

final class RedisSessionHandler implements SessionHandlerInterface, SessionUpdateTimestampHandlerInterface
{
    /** @var Redis phpredis 연결 */
    private Redis $redis;

    /**
     * Redis 에 접속한다.
     *
     * @throws ApiException 503 — 세션 저장소에 접속할 수 없을 때
     */
    public function __construct()
    {
        $this->redis = new Redis();
        try {
            // 세 번째 인자 2.0 = 접속 제한 시간(초). Redis 가 죽어 있어도 요청이 오래 멈추지 않게 한다
            $this->redis->connect(REDIS_HOST, REDIS_PORT, 2.0);
        } catch (RedisException $e) {
            error_log('[Session] Redis 접속 실패: ' . $e->getMessage());
            throw new ApiException(503, 'SESSION_STORE_UNAVAILABLE', '세션 저장소에 접속할 수 없습니다.');
        }
    }

    /** Redis 키 이름을 만든다. 예) session:9f1c... */
    private function key(string $id): string
    {
        return SESSION_KEY_PREFIX . $id;
    }

    /** 세션 시작 시 호출. 연결은 생성자에서 이미 열었으므로 할 일이 없다. */
    public function open(string $path, string $name): bool
    {
        return true;
    }

    /** 요청이 끝날 때 호출. 연결을 닫는다. */
    public function close(): bool
    {
        $this->redis->close();
        return true;
    }

    /**
     * 세션 데이터를 읽는다. 없으면 빈 문자열(= 빈 세션)을 돌려준다.
     *
     * @return string PHP 직렬화 문자열
     */
    public function read(string $id): string|false
    {
        $data = $this->redis->get($this->key($id));
        return $data === false ? '' : (string) $data;
    }

    /**
     * 세션 데이터를 저장하고 만료 시간을 다시 설정한다(setex).
     * $_SESSION 내용이 바뀐 요청이 끝날 때 PHP 가 호출한다.
     */
    public function write(string $id, string $data): bool
    {
        return (bool) $this->redis->setex($this->key($id), SESSION_TTL, $data);
    }

    /** 세션을 삭제한다 (로그아웃, session_regenerate_id(true) 의 이전 ID 삭제). */
    public function destroy(string $id): bool
    {
        $this->redis->del($this->key($id));
        return true;
    }

    /** 만료 세션 정리. Redis TTL 이 자동으로 지우므로 따로 할 일이 없다. */
    public function gc(int $max_lifetime): int|false
    {
        return 0;
    }

    /**
     * use_strict_mode 에서 호출: 브라우저가 보낸 세션 ID 가 실제로 있는지 확인한다.
     * 없는 ID 면 PHP 가 새 ID 를 만든다 (공격자가 정한 ID 를 쓰지 못하게 함).
     */
    public function validateId(string $id): bool
    {
        return (bool) $this->redis->exists($this->key($id));
    }

    /**
     * 세션 내용이 바뀌지 않은 요청에서 write 대신 호출된다.
     * 데이터는 그대로 두고 만료 시간만 늘린다 (슬라이딩 만료).
     */
    public function updateTimestamp(string $id, string $data): bool
    {
        return (bool) $this->redis->expire($this->key($id), SESSION_TTL);
    }
}

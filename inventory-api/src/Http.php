<?php
/**
 * Http.php
 * ------------------------------------------------------------
 * 역할 : 요청 본문 읽기, 공통 JSON 응답, API 오류 예외를 정의한다.
 *
 * 공통 응답 형식 (재고 서버·생산 서버 동일)
 *   성공 : { "success": true,  "data": {...}, "servedBy": "erp-inventory-api" }
 *   실패 : { "success": false, "error": { "code": "...", "message": "...", "details": [...] },
 *            "servedBy": "erp-inventory-api" }
 * servedBy 는 응답한 컨테이너 hostname 이다. 화면에서 어느 서버가 처리했는지 보여주는 데 쓴다.
 * ------------------------------------------------------------
 */

declare(strict_types=1);

/**
 * API 처리 중 의도한 오류(401, 403, 409 등)를 나타내는 예외.
 * 라우터(index.php)가 잡아서 공통 실패 응답으로 바꾼다.
 */
final class ApiException extends RuntimeException
{
    /**
     * @param int    $status    HTTP 상태 코드
     * @param string $errorCode 화면에서 구분할 오류 코드 (예: INVALID_CREDENTIALS)
     * @param string $message   사용자에게 보여줄 한국어 메시지
     * @param array  $details   부족 자재 목록 등 추가 정보
     */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $details = []
    ) {
        parent::__construct($message);
    }
}

final class Http
{
    /**
     * 요청 본문을 배열로 읽는다.
     * 프론트는 JSON(application/json)으로 보내지만, 폼 전송($_POST)도 받아준다.
     *
     * @return array<string, mixed>
     * @throws ApiException 400 — JSON 형식이 잘못됐을 때
     */
    public static function body(): array
    {
        if (!empty($_POST)) {
            return $_POST;
        }
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new ApiException(400, 'INVALID_JSON', '요청 본문이 올바른 JSON 형식이 아닙니다.');
        }
        return $data;
    }

    /**
     * 성공 응답을 JSON 으로 보낸다.
     *
     * @param mixed $data   응답 데이터
     * @param int   $status HTTP 상태 코드 (기본 200)
     */
    public static function ok(mixed $data, int $status = 200): void
    {
        self::send($status, ['success' => true, 'data' => $data, 'servedBy' => SERVED_BY]);
    }

    /**
     * 실패 응답을 JSON 으로 보낸다.
     *
     * @param ApiException $e
     */
    public static function fail(ApiException $e): void
    {
        $error = ['code' => $e->errorCode, 'message' => $e->getMessage()];
        if ($e->details) {
            $error['details'] = $e->details;
        }
        self::send($e->status, ['success' => false, 'error' => $error, 'servedBy' => SERVED_BY]);
    }

    /**
     * 상태 코드와 JSON 본문을 실제로 출력한다.
     * 한글이 \uXXXX 로 깨져 보이지 않도록 JSON_UNESCAPED_UNICODE 를 쓴다.
     */
    private static function send(int $status, array $payload): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');   // 세션·재고 정보는 캐시하지 않는다
        echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    }
}

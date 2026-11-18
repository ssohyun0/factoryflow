<?php
/**
 * Db.php
 * ------------------------------------------------------------
 * 역할 : MySQL(erp_inventory 스키마) PDO 연결을 하나만 만들어 재사용한다.
 * 사용 : 각 Controller / Repository 에서 Db::pdo() 로 연결을 얻는다.
 * 원칙 : SQL 은 반드시 Prepared Statement(prepare + execute)로만 실행한다 (SQL 인젝션 방지).
 * ------------------------------------------------------------
 */

declare(strict_types=1);

final class Db
{
    /** @var PDO|null 요청 하나 동안 재사용할 연결 */
    private static ?PDO $pdo = null;

    /**
     * PDO 연결을 돌려준다. 처음 호출할 때 접속한다.
     *
     * @return PDO
     * @throws ApiException 503 — DB 컨테이너에 접속할 수 없을 때
     */
    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', DB_HOST, DB_PORT, DB_NAME);
            try {
                self::$pdo = new PDO($dsn, DB_USER, DB_PASSWORD, [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,   // 오류는 예외로 받는다
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,         // 결과는 연관 배열
                    PDO::ATTR_EMULATE_PREPARES   => false,                    // 진짜 서버측 Prepared Statement 사용
                ]);
            } catch (PDOException $e) {
                error_log('[Db] 접속 실패: ' . $e->getMessage());
                throw new ApiException(503, 'DB_UNAVAILABLE', '데이터베이스에 접속할 수 없습니다.');
            }
        }
        return self::$pdo;
    }

    /**
     * SELECT 를 실행하고 모든 행을 돌려준다.
     *
     * @param string $sql    ? 자리표시자를 쓴 SQL
     * @param array  $params 자리표시자에 들어갈 값
     * @return array<int, array<string, mixed>>
     */
    public static function fetchAll(string $sql, array $params = []): array
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /**
     * SELECT 를 실행하고 첫 행만 돌려준다. 없으면 null.
     *
     * @param string $sql
     * @param array  $params
     * @return array<string, mixed>|null
     */
    public static function fetchOne(string $sql, array $params = []): ?array
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * INSERT / UPDATE / DELETE 를 실행하고 바뀐 행 수를 돌려준다.
     *
     * @param string $sql
     * @param array  $params
     * @return int
     */
    public static function execute(string $sql, array $params = []): int
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    }
}

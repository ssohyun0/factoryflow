<?php
/**
 * InternalController.php
 * ------------------------------------------------------------
 * 역할 : 생산 서버(FastAPI, erp-production-api-1~3)만 호출하는 내부 API. (마이크로서비스 간 통신)
 *
 *   POST /internal/stock/check    생산계획 확인 : 트리별 수량 → BOM 전개 → 부족 자재 목록 (재고 변경 없음)
 *   POST /internal/stock/produce  작업지시 완료 : 자재 차감 + 완성 트리 입고 (하나의 트랜잭션)
 *   POST /internal/stock/ship     출하          : 완성 트리 차감 (하나의 트랜잭션)
 *
 * 보안
 *   - 브라우저 쿠키(세션)가 아니라 X-Internal-Token 헤더(서비스 간 공유 비밀값)로 호출자를 확인한다.
 *   - 처리자는 생산 서버가 자기 쪽 세션에서 꺼낸 userId 를 본문으로 넘겨준다.
 *   - 프록시(erp-proxy)는 외부에서 오는 /api/inventory/internal 요청을 403 으로 막고,
 *     이 경로(/internal/*)는 프록시 라우팅에 아예 없으므로 erp-net 안에서만 호출할 수 있다.
 *
 * 실패 시 원칙 : 부족하면 409 와 "부족한 자재 전부"를 돌려주고, 재고와 이력은 하나도 바꾸지 않는다(롤백).
 * ------------------------------------------------------------
 */

declare(strict_types=1);

final class InternalController
{
    /**
     * 내부 호출인지 확인한다. 토큰 비교는 hash_equals 로 해서 비교 시간으로 값을 추측하지 못하게 한다.
     *
     * @throws ApiException 403 — 토큰이 없거나 틀림
     */
    private static function requireInternal(): void
    {
        $token = $_SERVER['HTTP_X_INTERNAL_TOKEN'] ?? '';
        if (!is_string($token) || !hash_equals(INTERNAL_TOKEN, $token)) {
            throw new ApiException(403, 'FORBIDDEN', '내부 API 는 생산 서버만 호출할 수 있습니다.');
        }
    }

    /**
     * 본문의 lines 배열을 검증한다. 예) [{ "treeCode":"T-CLASSIC", "qty":3 }]
     * qty 가 0 인 줄은 건너뛴다 (계획 수량을 0 으로 둔 모델).
     *
     * @return array<int, array{treeCode:string, qty:int}>
     * @throws ApiException 400
     */
    private static function parseLines(mixed $lines): array
    {
        if (!is_array($lines)) {
            throw new ApiException(400, 'VALIDATION_ERROR', 'lines 는 배열이어야 합니다.');
        }
        $out = [];
        foreach ($lines as $l) {
            $tree = is_array($l) ? (string) ($l['treeCode'] ?? '') : '';
            $qty  = is_array($l) ? filter_var($l['qty'] ?? null, FILTER_VALIDATE_INT) : false;
            if ($tree === '' || $qty === false || $qty < 0 || $qty > 10000) {
                throw new ApiException(400, 'VALIDATION_ERROR', '각 줄에는 treeCode 와 0~10000 사이의 qty 가 필요합니다.');
            }
            if ($qty > 0) {
                $out[] = ['treeCode' => $tree, 'qty' => $qty];
            }
        }
        return $out;
    }

    /**
     * 처리자 userId 를 검증한다 (수불 이력의 외래키가 users.id 를 가리킴).
     *
     * @throws ApiException 400 — 없는 사용자
     */
    private static function parseUserId(mixed $value): int
    {
        $id = filter_var($value, FILTER_VALIDATE_INT);
        if ($id === false || Db::fetchOne('SELECT id FROM users WHERE id = ?', [$id]) === null) {
            throw new ApiException(400, 'VALIDATION_ERROR', '처리자(userId)가 올바르지 않습니다.');
        }
        return $id;
    }

    /** 여러 품목의 현재 재고를 [코드 => 수량] 으로 읽는다. $lock 이면 FOR UPDATE 로 잠근다(코드 순서대로). */
    private static function stockOf(array $codes, bool $lock): array
    {
        sort($codes);
        $stock = [];
        foreach ($codes as $code) {
            $stock[$code] = $lock
                ? StockService::lockQty($code)
                : (int) (Db::fetchOne('SELECT qty FROM stock WHERE item_code = ?', [$code])['qty'] ?? 0);
        }
        return $stock;
    }

    /**
     * 생산계획 확인 (재고를 바꾸지 않는다).
     * 생산 서버는 "대기 중인 작업지시 + 새 계획 줄"을 합쳐서 보낸다 → 사용 가능 수량 기준 판정이 된다.
     *
     * 요청 : { "lines": [{ "treeCode":"T-CLASSIC", "qty":13 }] }
     * 응답 : { "ok": false, "need": {"RIBBON":52, ...}, "shortages": [{ "itemCode":"RIBBON", "name":"벨벳 리본",
     *          "need":52, "stock":44, "short":8 }, ...] }
     */
    public static function check(): void
    {
        self::requireInternal();
        $lines = self::parseLines(Http::body()['lines'] ?? null);
        $need  = BomService::aggregate(BomService::loadBom(), $lines);
        $short = BomService::withNames(BomService::shortages($need, self::stockOf(array_keys($need), false)));
        Http::ok(['ok' => !$short, 'need' => (object) $need, 'shortages' => $short]);
    }

    /**
     * 작업지시 완료 반영: 자재 차감(CONSUME) + 완성 트리 입고(PRODUCE).
     * 모든 단계가 하나의 트랜잭션이라, 하나라도 부족하면 아무것도 바뀌지 않는다.
     *
     * 요청 : { "treeCode":"T-CLASSIC", "qty":5, "userId":2, "woNo":"WO-1201-001" }
     * 응답 : { "treeCode":"T-CLASSIC", "qty":5, "treeStock":11, "consumed":[{ "itemCode":"FIR-150", "qty":5, "stockAfter":35 }, ...] }
     * @throws ApiException 409 — 자재 부족 (details = 부족한 자재 전부)
     */
    public static function produce(): void
    {
        self::requireInternal();
        $body   = Http::body();
        $lines  = self::parseLines([['treeCode' => $body['treeCode'] ?? '', 'qty' => $body['qty'] ?? null]]);
        if (!$lines) {
            throw new ApiException(400, 'VALIDATION_ERROR', '생산 수량은 1 이상이어야 합니다.');
        }
        $userId = self::parseUserId($body['userId'] ?? null);
        $woNo   = mb_substr((string) ($body['woNo'] ?? ''), 0, 30) ?: null;
        [$line] = $lines;

        $result = Db::transaction(function () use ($line, $userId, $woNo) {
            $need  = BomService::aggregate(BomService::loadBom(), [$line]);
            // 1) 필요한 자재 행을 전부 잠그고 2) 부족한 것이 하나라도 있으면 모두 모아 409
            $short = BomService::shortages($need, self::stockOf(array_keys($need), true));
            if ($short) {
                throw new ApiException(409, 'INSUFFICIENT_STOCK', '자재가 부족해 작업지시를 완료할 수 없습니다.', BomService::withNames($short));
            }
            // 3) 자재 차감
            $consumed = [];
            foreach ($need as $itemCode => $n) {
                $after = StockService::change($itemCode, -$n, 'CONSUME', $userId, $woNo);
                $consumed[] = ['itemCode' => $itemCode, 'qty' => $n, 'stockAfter' => $after];
            }
            // 4) 완성 트리 입고
            $treeStock = StockService::change($line['treeCode'], $line['qty'], 'PRODUCE', $userId, $woNo);
            return ['treeCode' => $line['treeCode'], 'qty' => $line['qty'], 'treeStock' => $treeStock, 'consumed' => $consumed];
        });

        Http::ok($result);
    }

    /**
     * 출하: 출하 작업서의 줄마다 완성 트리를 차감(SHIP)하고 출하처를 이력 메모에 남긴다.
     *
     * 요청 : { "userId":2, "rows":[{ "treeCode":"T-CLASSIC", "destination":"강남 물류센터", "qty":3 }, ...] }
     * 응답 : { "rows":[...], "treeStock":{ "T-CLASSIC": 8, ... } }
     * @throws ApiException 409 — 완성 트리 재고보다 많이 출하하려 함 (트리별 합계로 판정)
     */
    public static function ship(): void
    {
        self::requireInternal();
        $body   = Http::body();
        $userId = self::parseUserId($body['userId'] ?? null);
        $rows   = $body['rows'] ?? null;
        if (!is_array($rows) || !$rows) {
            throw new ApiException(400, 'VALIDATION_ERROR', '출하할 줄(rows)이 필요합니다.');
        }

        // 줄 검증 + 트리별 합계
        $clean = [];
        $sum = [];
        foreach ($rows as $r) {
            $tree = is_array($r) ? (string) ($r['treeCode'] ?? '') : '';
            $dest = is_array($r) ? mb_substr(trim((string) ($r['destination'] ?? '')), 0, 50) : '';
            $qty  = is_array($r) ? filter_var($r['qty'] ?? null, FILTER_VALIDATE_INT) : false;
            if ($dest === '' || $qty === false || $qty < 1 || $qty > 10000) {
                throw new ApiException(400, 'VALIDATION_ERROR', '각 줄에는 트리, 출하처, 1 이상의 수량이 필요합니다.');
            }
            $item = Db::fetchOne('SELECT kind FROM items WHERE code = ?', [$tree]);
            if ($item === null || $item['kind'] !== 'TREE') {
                throw new ApiException(400, 'VALIDATION_ERROR', "출하할 수 없는 품목입니다: {$tree}");
            }
            $clean[] = ['treeCode' => $tree, 'destination' => $dest, 'qty' => $qty];
            $sum[$tree] = ($sum[$tree] ?? 0) + $qty;
        }

        $result = Db::transaction(function () use ($clean, $sum, $userId) {
            $short = BomService::shortages($sum, self::stockOf(array_keys($sum), true));
            if ($short) {
                throw new ApiException(409, 'INSUFFICIENT_STOCK', '완성 트리 재고보다 많이 출하할 수 없습니다.', BomService::withNames($short));
            }
            $after = [];
            foreach ($clean as $r) {
                $after[$r['treeCode']] = StockService::change($r['treeCode'], -$r['qty'], 'SHIP', $userId, null, $r['destination']);
            }
            return ['rows' => $clean, 'treeStock' => $after];
        });

        Http::ok($result);
    }
}

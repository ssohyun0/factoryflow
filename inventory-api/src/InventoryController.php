<?php
/**
 * InventoryController.php
 * ------------------------------------------------------------
 * 역할 : 화면(대시보드·트리 모델·재고 탭)이 쓰는 재고 서비스 API.
 *
 *   GET  /api/inventory/items?kind=MAT|TREE   품목 + 현재 재고 + 안전재고
 *   GET  /api/inventory/models                트리 모델 3종과 BOM(1그루당 소요량)
 *   GET  /api/inventory/transactions?limit=N  수불 이력 (최근순)
 *   POST /api/inventory/receipts              자재 입고 (ADMIN = 산타만)
 *
 * 모든 API 는 로그인이 필요하다 (Session::requireUser).
 * ------------------------------------------------------------
 */

declare(strict_types=1);

final class InventoryController
{
    /**
     * 품목 목록과 현재 재고.
     * kind 를 주면 자재(MAT) 또는 완성 트리(TREE)만 돌려준다.
     *
     * 응답 예 : [{ "code":"FIR-150", "name":"전나무 150cm", "shortName":null, "kind":"MAT",
     *             "safetyStock":20, "stock":40 }, ...]
     */
    public static function items(): void
    {
        Session::requireUser();
        $kind = $_GET['kind'] ?? null;
        if ($kind !== null && !in_array($kind, ['MAT', 'TREE'], true)) {
            throw new ApiException(400, 'VALIDATION_ERROR', 'kind 는 MAT 또는 TREE 여야 합니다.');
        }

        $sql = 'SELECT i.code, i.name, i.short_name, i.kind, i.safety_stock, s.qty
                  FROM items i JOIN stock s ON s.item_code = i.code'
             . ($kind !== null ? ' WHERE i.kind = ?' : '')
             . ' ORDER BY i.sort_order';
        $rows = Db::fetchAll($sql, $kind !== null ? [$kind] : []);

        // DB 컬럼(snake_case)을 화면용 이름(camelCase)과 숫자 타입으로 바꾼다
        Http::ok(array_map(fn(array $r) => [
            'code'        => $r['code'],
            'name'        => $r['name'],
            'shortName'   => $r['short_name'],
            'kind'        => $r['kind'],
            'safetyStock' => (int) $r['safety_stock'],
            'stock'       => (int) $r['qty'],
        ], $rows));
    }

    /**
     * 트리 모델과 BOM.
     *
     * 응답 예 : [{ "code":"T-CLASSIC", "name":"클래식 레드 트리", "shortName":"레드 트리", "stock":6,
     *             "bom":[{ "itemCode":"FIR-150", "name":"전나무 150cm", "qtyPerTree":1, "stock":40 }, ...] }, ...]
     */
    public static function models(): void
    {
        Session::requireUser();
        $trees = Db::fetchAll(
            "SELECT i.code, i.name, i.short_name, s.qty
               FROM items i JOIN stock s ON s.item_code = i.code
              WHERE i.kind = 'TREE' ORDER BY i.sort_order"
        );
        $lines = Db::fetchAll(
            'SELECT b.tree_code, b.item_code, b.qty_per_tree, i.name, s.qty
               FROM bom_lines b
               JOIN items i ON i.code = b.item_code
               JOIN stock s ON s.item_code = b.item_code
              ORDER BY b.tree_code, i.sort_order'
        );

        // BOM 줄을 트리 코드별로 묶는다
        $bomByTree = [];
        foreach ($lines as $l) {
            $bomByTree[$l['tree_code']][] = [
                'itemCode'   => $l['item_code'],
                'name'       => $l['name'],
                'qtyPerTree' => (int) $l['qty_per_tree'],
                'stock'      => (int) $l['qty'],
            ];
        }

        Http::ok(array_map(fn(array $t) => [
            'code'      => $t['code'],
            'name'      => $t['name'],
            'shortName' => $t['short_name'],
            'stock'     => (int) $t['qty'],
            'bom'       => $bomByTree[$t['code']] ?? [],
        ], $trees));
    }

    /**
     * 수불 이력 (최근순). limit 기본 50, 최대 200.
     *
     * 응답 예 : [{ "id":3, "at":"2026-12-01 10:20:00", "itemCode":"SNOW", "itemName":"눈꽃 장식",
     *             "type":"RECEIPT", "qty":20, "balanceAfter":50, "username":"santa", "refNo":null, "memo":"북극 장식상사" }]
     */
    public static function transactions(): void
    {
        Session::requireUser();
        $limit = max(1, min(200, (int) ($_GET['limit'] ?? 50)));

        // LIMIT 에는 자리표시자 대신 위에서 정수로 검증한 값을 넣는다 (MySQL 서버측 prepare 제약)
        $rows = Db::fetchAll(
            "SELECT t.id, t.created_at, t.item_code, i.name AS item_name, t.type, t.qty, t.balance_after,
                    u.username, t.ref_no, t.memo
               FROM stock_transactions t
               JOIN items i ON i.code = t.item_code
               JOIN users u ON u.id = t.user_id
              ORDER BY t.id DESC
              LIMIT {$limit}"
        );

        Http::ok(array_map(fn(array $r) => [
            'id'           => (int) $r['id'],
            'at'           => $r['created_at'],
            'itemCode'     => $r['item_code'],
            'itemName'     => $r['item_name'],
            'type'         => $r['type'],
            'qty'          => (int) $r['qty'],
            'balanceAfter' => (int) $r['balance_after'],
            'username'     => $r['username'],
            'refNo'        => $r['ref_no'],
            'memo'         => $r['memo'],
        ], $rows));
    }

    /**
     * 자재 입고 (산타 전용).
     * 요청 : { "itemCode": "PINECONE", "qty": 12, "supplier": "북극 장식상사" }
     * 응답 : { "itemCode":"PINECONE", "name":"솔방울", "qty":12, "stock":20 }
     *
     * @throws ApiException 403 — 루돌프(WORKER)가 호출
     * @throws ApiException 400 — 자재가 아닌 품목(완성 트리), 수량이 1~10000 범위를 벗어남
     */
    public static function receipt(): void
    {
        $user = Session::requireUser('ADMIN');
        $body = Http::body();

        $itemCode = trim((string) ($body['itemCode'] ?? ''));
        $qty      = filter_var($body['qty'] ?? null, FILTER_VALIDATE_INT);
        $supplier = mb_substr(trim((string) ($body['supplier'] ?? '')), 0, 100);

        if ($qty === false || $qty < 1 || $qty > 10000) {
            throw new ApiException(400, 'VALIDATION_ERROR', '입고 수량은 1 이상 10000 이하의 정수여야 합니다.');
        }
        $item = Db::fetchOne('SELECT code, name, kind FROM items WHERE code = ?', [$itemCode]);
        if ($item === null) {
            throw new ApiException(404, 'ITEM_NOT_FOUND', '품목을 찾을 수 없습니다.');
        }
        if ($item['kind'] !== 'MAT') {
            throw new ApiException(400, 'VALIDATION_ERROR', '완성 트리는 입고할 수 없습니다. 자재만 입고하세요.');
        }

        // 재고 증가 + 이력 기록을 하나의 트랜잭션으로
        $stock = Db::transaction(
            fn() => StockService::change($itemCode, $qty, 'RECEIPT', $user['userId'], null, $supplier !== '' ? $supplier : null)
        );

        Http::ok(['itemCode' => $itemCode, 'name' => $item['name'], 'qty' => $qty, 'stock' => $stock], 201);
    }
}

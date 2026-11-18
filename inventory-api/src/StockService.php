<?php
/**
 * StockService.php
 * ------------------------------------------------------------
 * 역할 : 재고를 바꾸는 유일한 통로. 재고 수량 변경과 수불 이력 기록을 항상 함께 처리한다.
 * 사용 : InventoryController(입고), InternalController(생산 반영·출하, T6)
 * 규칙 : 반드시 Db::transaction() 안에서 호출한다.
 *        재고 행을 SELECT ... FOR UPDATE 로 잠가, 동시에 들어온 요청(생산 서버 3개)이
 *        같은 재고를 동시에 깎아 음수가 되는 일을 막는다.
 * ------------------------------------------------------------
 */

declare(strict_types=1);

final class StockService
{
    /**
     * 품목 하나의 현재 재고를 잠그고 읽는다 (트랜잭션 안에서만 의미가 있다).
     *
     * @param string $itemCode 품목 코드
     * @return int 현재 재고
     * @throws ApiException 404 — 없는 품목
     */
    public static function lockQty(string $itemCode): int
    {
        $row = Db::fetchOne('SELECT qty FROM stock WHERE item_code = ? FOR UPDATE', [$itemCode]);
        if ($row === null) {
            throw new ApiException(404, 'ITEM_NOT_FOUND', "품목을 찾을 수 없습니다: {$itemCode}");
        }
        return (int) $row['qty'];
    }

    /**
     * 재고를 증감하고 수불 이력을 남긴다.
     *
     * @param string      $itemCode 품목 코드
     * @param int         $delta    증감량 (입고·생산입고 +, 생산투입·출하 -)
     * @param string      $type     RECEIPT | CONSUME | PRODUCE | SHIP
     * @param int         $userId   처리자 (세션 또는 생산 서버가 넘겨준 사용자 ID)
     * @param string|null $refNo    관련 작업지시 번호
     * @param string|null $memo     공급처, 출하처 등
     * @return int 처리 후 재고
     * @throws ApiException 409 — 차감 후 재고가 음수가 되는 경우
     */
    public static function change(string $itemCode, int $delta, string $type, int $userId, ?string $refNo = null, ?string $memo = null): int
    {
        $current = self::lockQty($itemCode);
        $after = $current + $delta;
        if ($after < 0) {
            throw new ApiException(409, 'INSUFFICIENT_STOCK', '재고가 부족합니다.', [
                ['itemCode' => $itemCode, 'need' => -$delta, 'stock' => $current, 'short' => -$after],
            ]);
        }
        Db::execute('UPDATE stock SET qty = ? WHERE item_code = ?', [$after, $itemCode]);
        Db::execute(
            'INSERT INTO stock_transactions (item_code, type, qty, balance_after, user_id, ref_no, memo) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$itemCode, $type, $delta, $after, $userId, $refNo, $memo]
        );
        return $after;
    }
}

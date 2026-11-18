<?php
/**
 * BomService.php
 * ------------------------------------------------------------
 * 역할 : BOM 전개(트리 수량 → 필요한 자재 수량)와 부족 자재 판정.
 * 사용 : InternalController (check / produce)
 *
 * 계산 예 (레드 트리 BOM: 전나무 1, 빨간 볼 12, 금색 별 1, LED 1, 리본 4)
 *   레드 트리 3그루 + 미니 트리 2그루 → 리본 = 4×3 + 2×2 = 16 (모델끼리 공유하는 자재는 합산)
 *
 * aggregate() 와 shortages() 는 DB 를 쓰지 않는 순수 함수라서
 * tests/run.php 에서 단위 테스트한다.
 * ------------------------------------------------------------
 */

declare(strict_types=1);

final class BomService
{
    /**
     * DB 에서 트리별 BOM 을 읽어 [트리코드 => [자재코드 => 1그루당 소요량]] 형태로 돌려준다.
     *
     * @return array<string, array<string, int>>
     */
    public static function loadBom(): array
    {
        $bom = [];
        foreach (Db::fetchAll('SELECT tree_code, item_code, qty_per_tree FROM bom_lines') as $r) {
            $bom[$r['tree_code']][$r['item_code']] = (int) $r['qty_per_tree'];
        }
        return $bom;
    }

    /**
     * 여러 줄(트리, 수량)의 자재 소요량을 합산한다. (순수 함수)
     *
     * @param array<string, array<string, int>> $bom   loadBom() 결과
     * @param array<int, array{treeCode:string, qty:int}> $lines
     * @return array<string, int> [자재코드 => 필요 수량]
     * @throws ApiException 400 — BOM 이 없는 트리 코드
     */
    public static function aggregate(array $bom, array $lines): array
    {
        $need = [];
        foreach ($lines as $line) {
            $tree = $line['treeCode'];
            if (!isset($bom[$tree])) {
                throw new ApiException(400, 'UNKNOWN_TREE', "BOM 이 없는 트리 모델입니다: {$tree}");
            }
            foreach ($bom[$tree] as $itemCode => $perTree) {
                $need[$itemCode] = ($need[$itemCode] ?? 0) + $perTree * $line['qty'];
            }
        }
        ksort($need);   // 자재 코드 순서로 정렬 (잠금 순서를 일정하게 해 교착 상태를 막는다)
        return $need;
    }

    /**
     * 필요 수량과 재고를 비교해 부족한 자재 목록을 만든다. (순수 함수)
     *
     * @param array<string, int> $need  [자재코드 => 필요 수량]
     * @param array<string, int> $stock [자재코드 => 현재 재고]
     * @return array<int, array{itemCode:string, need:int, stock:int, short:int}>
     */
    public static function shortages(array $need, array $stock): array
    {
        $short = [];
        foreach ($need as $itemCode => $n) {
            $have = $stock[$itemCode] ?? 0;
            if ($n > $have) {
                $short[] = ['itemCode' => $itemCode, 'need' => $n, 'stock' => $have, 'short' => $n - $have];
            }
        }
        return $short;
    }

    /**
     * 부족 목록에 자재 이름을 붙인다 (화면에 "금색 별 1개 부족"처럼 보여주기 위함).
     *
     * @param array<int, array<string, mixed>> $shortages
     * @return array<int, array<string, mixed>>
     */
    public static function withNames(array $shortages): array
    {
        if (!$shortages) {
            return [];
        }
        $names = [];
        foreach (Db::fetchAll('SELECT code, name FROM items') as $r) {
            $names[$r['code']] = $r['name'];
        }
        return array_map(fn(array $s) => ['itemCode' => $s['itemCode'], 'name' => $names[$s['itemCode']] ?? $s['itemCode']] + $s, $shortages);
    }
}

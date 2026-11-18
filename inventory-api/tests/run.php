<?php
/**
 * tests/run.php — erp-inventory-api 단위 테스트 (PHPUnit 없이 간단한 assert 함수로 실행)
 * ------------------------------------------------------------
 * 실행 : docker exec erp-inventory-api php /var/www/tests/run.php
 * 대상 : BomService 의 순수 함수 (DB 없이 계산만 검사)
 *   - aggregate()  : 트리 수량 → 자재 소요량 합산 (모델끼리 공유하는 자재 포함)
 *   - shortages()  : 소요량과 재고 비교 → 부족 자재 목록
 * 결과 : 모두 통과하면 "ALL PASS" 와 종료 코드 0, 하나라도 실패하면 종료 코드 1
 * ------------------------------------------------------------
 */

declare(strict_types=1);

require __DIR__ . '/../src/Http.php';        // ApiException 정의
require __DIR__ . '/../src/BomService.php';

$failed = 0;

/** 기대값과 실제값이 같은지 확인하고 결과를 출력한다. */
function check(string $name, mixed $expected, mixed $actual): void
{
    global $failed;
    if ($expected === $actual) {
        echo "PASS  {$name}\n";
    } else {
        $failed++;
        echo "FAIL  {$name}\n      expected: " . json_encode($expected) . "\n      actual:   " . json_encode($actual) . "\n";
    }
}

// 시드 데이터와 같은 BOM (db/init/02-seed.sql)
$bom = [
    'T-CLASSIC' => ['FIR-150' => 1, 'BALL-RED' => 12, 'STAR-GOLD' => 1, 'LIGHT' => 1, 'RIBBON' => 4],
    'T-SNOW'    => ['FIR-150' => 1, 'SNOW' => 10, 'STAR-SLV' => 1, 'LIGHT' => 1, 'BALL-GOLD' => 6],
    'T-MINI'    => ['FIR-60' => 1, 'MINI-BALL' => 6, 'RIBBON' => 2, 'PINECONE' => 1],
];

// 1) 한 모델: 레드 트리 3그루
$need = BomService::aggregate($bom, [['treeCode' => 'T-CLASSIC', 'qty' => 3]]);
check('레드 트리 3그루 → 빨간 볼 36', 36, $need['BALL-RED']);
check('레드 트리 3그루 → 리본 12', 12, $need['RIBBON']);

// 2) 공유 자재 합산: 레드 3 + 미니 2 → 리본 4×3 + 2×2 = 16
$need = BomService::aggregate($bom, [['treeCode' => 'T-CLASSIC', 'qty' => 3], ['treeCode' => 'T-MINI', 'qty' => 2]]);
check('레드 3 + 미니 2 → 리본 16 (공유 자재 합산)', 16, $need['RIBBON']);
check('레드 3 + 미니 2 → 자재 종류 8', 8, count($need));
check('결과는 자재 코드 순으로 정렬', array_keys($need), (function ($n) { ksort($n); return array_keys($n); })($need));

// 3) 스펙 SC-9 사례: 대기 레드 11 + 새 계획 레드 2 = 13그루 → 금색 별 1, 리본 8 부족
$need  = BomService::aggregate($bom, [['treeCode' => 'T-CLASSIC', 'qty' => 11], ['treeCode' => 'T-CLASSIC', 'qty' => 2]]);
$stock = ['FIR-150' => 40, 'BALL-RED' => 240, 'STAR-GOLD' => 12, 'LIGHT' => 25, 'RIBBON' => 44];
$short = BomService::shortages($need, $stock);
check('레드 13그루 → 부족 2종', 2, count($short));
check('부족: 리본 8', ['itemCode' => 'RIBBON', 'need' => 52, 'stock' => 44, 'short' => 8], $short[0]);
check('부족: 금색 별 1', ['itemCode' => 'STAR-GOLD', 'need' => 13, 'stock' => 12, 'short' => 1], $short[1]);

// 4) 재고가 충분하면 부족 없음
check('레드 11그루 → 부족 없음', [], BomService::shortages(BomService::aggregate($bom, [['treeCode' => 'T-CLASSIC', 'qty' => 11]]), $stock));

// 5) 없는 트리 코드는 400 예외
try {
    BomService::aggregate($bom, [['treeCode' => 'T-NONE', 'qty' => 1]]);
    check('없는 트리 → 예외', 'exception', 'no exception');
} catch (ApiException $e) {
    check('없는 트리 → 400 UNKNOWN_TREE', [400, 'UNKNOWN_TREE'], [$e->status, $e->errorCode]);
}

echo $failed === 0 ? "\nALL PASS\n" : "\n{$failed} FAILED\n";
exit($failed === 0 ? 0 : 1);

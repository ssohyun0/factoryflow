# ------------------------------------------------------------
# erp-inventory-api 이미지 (서버 A : 재고 서비스, PHP)
# 역할 : 로그인·로그아웃·세션 발급, 품목·BOM·재고·입고 API,
#        생산 서버만 호출하는 내부 API(/internal/*)를 제공한다.
# 빌드 : docker build --platform linux/amd64 -t ssohyun/erp-inventory-api:1.0 ./inventory-api
# 참고 : 수업 실습(php-mysql, Redis 세션 공유)과 같은 베이스 이미지와 확장 설치 방식을 쓴다.
#        소스는 바인드 마운트가 아니라 COPY로 이미지에 넣는다(이슈 20: 이미지만으로 실행 가능해야 함).
# ------------------------------------------------------------
FROM php:8.1-apache-bookworm

# 컨테이너 시간대 (수불 이력 시각)
ENV TZ=Asia/Seoul

# PHP 확장 설치 (무거운 단계라 소스 COPY보다 위에 두어 빌드 캐시를 재사용한다)
#  - pdo_mysql : PDO로 MySQL 접속 (Prepared Statement 사용)
#  - redis     : phpredis 확장. PHP 세션을 Redis에 저장하는 데 쓴다 (pecl로 설치)
#                `yes ''`는 pecl 설치 중 나오는 선택 질문에 기본값(엔터)으로 답한다
RUN docker-php-ext-install pdo_mysql \
 && yes '' | pecl install redis-6.1.0 \
 && docker-php-ext-enable redis \
 && rm -rf /tmp/pear

# Apache 설정: 존재하지 않는 경로(/api/..., /internal/...)를 모두 index.php(라우터)로 보낸다
COPY conf/apache-factoryflow.conf /etc/apache2/conf-enabled/factoryflow.conf

# PHP 설정: 세션 쿠키 보안 옵션, 시간대, 오류 표시 끄기
COPY conf/php-factoryflow.ini /usr/local/etc/php/conf.d/factoryflow.ini

# 애플리케이션 소스 (웹 루트에는 진입점 index.php만 두고, 나머지 코드는 웹에서 직접 열 수 없는 위치에 둔다)
COPY public/ /var/www/html/
COPY src/    /var/www/src/

EXPOSE 80

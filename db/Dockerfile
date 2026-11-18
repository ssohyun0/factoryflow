# ------------------------------------------------------------
# erp-mysql 이미지
# 역할 : FactoryFlow의 데이터베이스(MySQL 8.0).
#        컨테이너가 처음 시작될 때(데이터 볼륨이 비어 있을 때) init/ 폴더의
#        SQL을 순서대로 실행해 스키마, 서비스별 계정, 시드 데이터를 만든다.
# 빌드 : docker build --platform linux/amd64 -t ssohyun/erp-mysql:1.0 ./db
# 참고 : mysql:8.0 공식 이미지는 bash를 포함하므로
#        `docker exec -it erp-mysql bash`가 동작한다.
# ------------------------------------------------------------
FROM mysql:8.0

# 컨테이너 시간대를 한국 시간으로 맞춘다 (수불 이력·작업지시 시각 표시용)
ENV TZ=Asia/Seoul

# 문자셋(utf8mb4)과 시간대 설정. conf.d 아래 .cnf 파일은 MySQL이 자동으로 읽는다
COPY conf/factoryflow.cnf /etc/mysql/conf.d/factoryflow.cnf

# 최초 기동 시 파일 이름 순서(01 → 02)대로 실행되는 초기화 SQL
COPY init/ /docker-entrypoint-initdb.d/

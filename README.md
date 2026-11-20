# FactoryFlow — 북극 트리 공장 미니 ERP

클라우드 네이티브 기말고사 대체과제. 크리스마스 트리 공장의 생산계획 → 작업지시 → 생산 완료 → 출하를 다루는 미니 ERP(생산관리·자재관리)입니다. Docker 컨테이너 8개(Nginx 프록시, 프론트, PHP 재고 서버, FastAPI 생산 서버 3개, MySQL, Redis)로 구성한 마이크로서비스 웹 애플리케이션입니다. Docker Compose 없이 `docker run`만으로 실행합니다.

- Docker Hub: `ssohyun/erp-inventory-api:1.0`, `ssohyun/erp-production-api:1.0`, `ssohyun/erp-frontend:1.0`, `ssohyun/erp-proxy:1.0` (모두 `linux/amd64`)
- DB·세션 저장소는 공식 이미지 `mysql:8.0`, `redis:7`을 그대로 씁니다.

## 구성

| 컨테이너 | 역할 | 이미지 | 공개 포트 |
|---|---|---|---|
| `erp-proxy` | 역방향 프록시, 경로별 라우팅, 생산 서버 3대 라운드로빈 | `ssohyun/erp-proxy:1.0` | **80** |
| `erp-frontend` | 화면 (HTML·CSS·JS + jQuery) | `ssohyun/erp-frontend:1.0` | - |
| `erp-inventory-api` | 서버 A (PHP 8.1): 로그인·세션 발급, 품목·BOM·재고·입고, 내부 API | `ssohyun/erp-inventory-api:1.0` | - |
| `erp-production-api-1~3` | 서버 B (FastAPI) ×3: 생산계획·작업지시·완료·출하 | `ssohyun/erp-production-api:1.0` | - |
| `erp-mysql` | MySQL 8.0 (스키마 `erp_inventory`, `erp_production`) | `mysql:8.0` | 127.0.0.1:3306 |
| `erp-redis` | Redis 7 (PHP·FastAPI 공유 세션) | `redis:7` | - |

## 설치와 실행

아래 명령을 Docker가 설치된 리눅스 VM에서 위에서부터 순서대로 실행합니다.

```bash
# 0. (arm64 호스트만) amd64 이미지 실행용 에뮬레이션 등록 — 호스트를 재부팅하면 다시 실행
docker run --privileged --rm tonistiigi/binfmt --install amd64

# 1. 소스 받기 (MySQL 초기화 SQL db/init 을 바인드 마운트하기 위해 필요)
cd ~ && git clone https://github.com/ssohyun0/factoryflow.git

# 2. 네트워크와 볼륨
docker network create erp-net
docker volume create erp-mysql-data
docker volume create erp-redis-data

# 3. DB와 세션 저장소
docker run -d --name erp-mysql --hostname erp-mysql --network erp-net -p 127.0.0.1:3306:3306 -e MYSQL_ROOT_PASSWORD=rootpw -e TZ=Asia/Seoul -v erp-mysql-data:/var/lib/mysql -v $HOME/factoryflow/db/init:/docker-entrypoint-initdb.d:ro mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --default-time-zone=+09:00
docker run -d --name erp-redis --hostname erp-redis --network erp-net -v erp-redis-data:/data redis:7 redis-server --appendonly yes

# 4. 재고 서버 (PHP)
docker run -d --name erp-inventory-api --hostname erp-inventory-api --network erp-net --platform linux/amd64 -e DB_HOST=erp-mysql -e DB_NAME=erp_inventory -e DB_USER=inventory_app -e DB_PASSWORD=inventory_pw -e REDIS_HOST=erp-redis -e INTERNAL_TOKEN=factoryflow-internal ssohyun/erp-inventory-api:1.0

# 5. 생산 서버 3대 (FastAPI): 같은 이미지, 같은 별칭 erp-production-pool, 이름과 hostname만 다름
docker run -d --name erp-production-api-1 --hostname erp-production-api-1 --network erp-net --network-alias erp-production-pool --platform linux/amd64 -e DB_HOST=erp-mysql -e DB_NAME=erp_production -e DB_USER=production_app -e DB_PASSWORD=production_pw -e REDIS_HOST=erp-redis -e INVENTORY_API_URL=http://erp-inventory-api -e INTERNAL_TOKEN=factoryflow-internal ssohyun/erp-production-api:1.0
docker run -d --name erp-production-api-2 --hostname erp-production-api-2 --network erp-net --network-alias erp-production-pool --platform linux/amd64 -e DB_HOST=erp-mysql -e DB_NAME=erp_production -e DB_USER=production_app -e DB_PASSWORD=production_pw -e REDIS_HOST=erp-redis -e INVENTORY_API_URL=http://erp-inventory-api -e INTERNAL_TOKEN=factoryflow-internal ssohyun/erp-production-api:1.0
docker run -d --name erp-production-api-3 --hostname erp-production-api-3 --network erp-net --network-alias erp-production-pool --platform linux/amd64 -e DB_HOST=erp-mysql -e DB_NAME=erp_production -e DB_USER=production_app -e DB_PASSWORD=production_pw -e REDIS_HOST=erp-redis -e INVENTORY_API_URL=http://erp-inventory-api -e INTERNAL_TOKEN=factoryflow-internal ssohyun/erp-production-api:1.0

# 6. 프론트
docker run -d --name erp-frontend --hostname erp-frontend --network erp-net --platform linux/amd64 ssohyun/erp-frontend:1.0

# 7. 프록시 (반드시 마지막: 시작할 때 다른 컨테이너 이름을 IP로 해석한다)
docker run -d --name erp-proxy --hostname erp-proxy --network erp-net --platform linux/amd64 -p 80:80 ssohyun/erp-proxy:1.0
```

- 생산 서버나 프론트 컨테이너를 다시 만들면(IP가 바뀔 수 있음) `docker restart erp-proxy`를 실행합니다.
- 비밀번호·토큰(`rootpw`, `inventory_pw`, `production_pw`, `factoryflow-internal`)은 시연용 공개 기본값입니다.

### 접속 주소 등록 (브라우저를 쓰는 PC에서 1회)

```bash
# macOS / Linux  (VM IP가 다르면 192.168.71.129 를 바꾼다)
sudo sh -c 'echo "192.168.71.129  factoryflow.test" >> /etc/hosts'
# Windows: 관리자 권한 메모장으로 C:\Windows\System32\drivers\etc\hosts 에 같은 줄 추가
```

브라우저에서 `http://factoryflow.test`로 접속합니다.

| 계정 | 비밀번호 | 역할 |
|---|---|---|
| `santa` | `santa123` | 산타 · 생산관리자 (생산계획, 작업지시 수량 수정, 자재 입고) |
| `reindeer` | `reindeer123` | 루돌프 · 현장 작업자 (작업지시 완료, 트리 출하) |

## 확인

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker network inspect erp-net -f '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{println}}{{end}}'
docker exec erp-production-api-1 pytest -q
docker exec erp-inventory-api php /var/www/tests/run.php
```

## 이미지 빌드와 업로드 (개발자용)

```bash
docker buildx build --platform linux/amd64 --provenance=false --sbom=false -t ssohyun/erp-inventory-api:1.0 --push ./inventory-api
docker buildx build --platform linux/amd64 --provenance=false --sbom=false -t ssohyun/erp-production-api:1.0 --push ./production-api
docker buildx build --platform linux/amd64 --provenance=false --sbom=false -t ssohyun/erp-frontend:1.0 --push ./frontend
docker buildx build --platform linux/amd64 --provenance=false --sbom=false -t ssohyun/erp-proxy:1.0 --push ./proxy
```

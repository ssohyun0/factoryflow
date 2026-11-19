# ------------------------------------------------------------
# erp-proxy 이미지 (역방향 프록시, Nginx)
# 역할 : 호스트 80번 포트로 들어온 요청을 경로별로 프론트·재고 서버·생산 서버 3대에 나눈다.
#        /api/production/* 는 upstream production_pool 로 라운드로빈 분산한다.
# 빌드 : docker build --platform linux/amd64 -t ssohyun/erp-proxy:1.0 ./proxy
# 실행 : 생산 서버 3개, 재고 서버, 프론트가 먼저 떠 있어야 한다 (시작할 때 이름을 IP로 해석)
# ------------------------------------------------------------
FROM nginx:1.27

ENV TZ=Asia/Seoul

# 프록시 설정 (기본 설정 파일을 덮어쓴다)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

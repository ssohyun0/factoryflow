# ------------------------------------------------------------
# erp-frontend 이미지 (정적 화면: HTML, CSS, 순수 JS + jQuery)
# 역할 : 브라우저가 받을 화면 파일만 제공한다. 빌드 도구 없이 파일을 그대로 복사한다.
# 빌드 : docker build --platform linux/amd64 -t ssohyun/erp-frontend:1.0 ./frontend
# 참고 : nginx:1.27 은 Debian 계열이라 docker exec -it erp-frontend bash 가 된다.
# ------------------------------------------------------------
FROM nginx:1.27

ENV TZ=Asia/Seoul

# 정적 파일 서버 설정 (기본 설정 파일을 덮어쓴다)
COPY nginx-frontend.conf /etc/nginx/conf.d/default.conf

# 화면 파일 (index.html, css/, js/)
COPY index.html /usr/share/nginx/html/index.html
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/

EXPOSE 80

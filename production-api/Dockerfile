# ------------------------------------------------------------
# erp-production-api 이미지 (서버 B : 생산 서비스, FastAPI)
# 역할 : 생산계획·작업지시·완료·출하 API. 같은 이미지로 컨테이너 3개
#        (erp-production-api-1~3)를 띄우고, 별칭 erp-production-pool 로 묶어 분산한다.
# 빌드 : docker build --platform linux/amd64 -t ssohyun/erp-production-api:1.0 ./production-api
# 참고 : 소스는 바인드 마운트가 아니라 COPY로 이미지에 넣는다(이미지만으로 실행 가능해야 함).
# ------------------------------------------------------------
FROM python:3.11-slim

# 컨테이너 시간대 (작업지시 완료 시각)
ENV TZ=Asia/Seoul \
    # .pyc 파일을 만들지 않고, 로그를 버퍼 없이 바로 docker logs 로 내보낸다
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# 패키지 설치 (무거운 단계라 소스 COPY보다 위에 두어 빌드 캐시를 재사용한다)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 애플리케이션 소스와 단위 테스트
# (docker exec erp-production-api-1 pytest -q 로 실행)
COPY pytest.ini .
COPY app/   ./app/
COPY tests/ ./tests/

EXPOSE 8000

# 0.0.0.0 으로 열어야 erp-net 의 다른 컨테이너(프록시, 재고 서버)가 접속할 수 있다
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

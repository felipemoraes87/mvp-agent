FROM python:3.11-slim

WORKDIR /app

COPY agno_service/requirements.txt ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends docker.io ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt

COPY agno_service/ ./
RUN addgroup --system app && adduser --system --ingroup app appuser && chown -R appuser:app /app

USER appuser

EXPOSE 8010

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010"]

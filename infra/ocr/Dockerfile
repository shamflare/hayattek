# Private OCR sidecar for HayatTek (Tesseract 5, Arabic + English, PDF via poppler).
# Runs offline: no network access is needed at runtime. Never expose it publicly —
# docker-compose binds it to 127.0.0.1 and the Django API is its only client.
FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng poppler-utils \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --home-dir /app ocr
WORKDIR /app
COPY server.py /app/server.py

ENV OCR_PORT=8884 \
    OCR_MAX_BYTES=26214400 \
    OCR_MAX_PAGES=10 \
    OCR_TIMEOUT=90 \
    OMP_THREAD_LIMIT=2 \
    PYTHONUNBUFFERED=1

USER ocr
EXPOSE 8884
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8884/health', timeout=3)" || exit 1
CMD ["python", "/app/server.py"]

# Production image for the Django API and the Celery worker.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/ ./
RUN useradd --system --create-home --uid 10001 hayat && chown -R hayat /app
USER hayat
ENV DJANGO_SETTINGS_MODULE=config.settings.prod PATH="/app/.venv/bin:$PATH"
RUN DJANGO_SECRET_KEY=build DATABASE_URL=sqlite:////tmp/x DJANGO_ALLOWED_HOSTS=x CSRF_TRUSTED_ORIGINS=https://x \
    python manage.py collectstatic --noinput
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "60", "--access-logfile", "-"]

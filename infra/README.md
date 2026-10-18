# infra

ملفات تجهيز للنشر — **لم يتم أي نشر عام**. النشر يحتاج قرار المالك ومراجعة قانونية (docs/SECURITY_MODEL.md §11).

- `docker/backend.Dockerfile` — صورة الـAPI (gunicorn) والـworker (نفس الصورة مع `celery -A config worker`).
- `docker/web.Dockerfile` — صورة Next.js.
- `nginx/hayattek.conf` — HTTPS وHSTS أمام الويب.
- `seaweedfs/s3.json` — هوية S3 لبيئة التطوير فقط.

متغيرات الإنتاج المطلوبة: `DJANGO_SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`, `S3_*`, `DJANGO_ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `HAYAT_PUBLIC_BASE_URL=https://hayattek.com`, `EMAIL_*`, و`HAYAT_ENFORCE_MFA=true` (الافتراضي في prod).

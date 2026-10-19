# infra

ملفات تجهيز للنشر — **لم يتم أي نشر عام**. النشر يحتاج قرار المالك ومراجعة قانونية (docs/SECURITY_MODEL.md §11).

- `docker/backend.Dockerfile` — صورة الـAPI (gunicorn) والـworker (نفس الصورة مع `celery -A config worker`).
- `docker/web.Dockerfile` — صورة Next.js.
- `nginx/hayattek.conf` — HTTPS وHSTS أمام الويب.
- `prodcheck/` — تمرين إنتاج محلي كامل بأسرار مؤقتة (انظر `prodcheck/README.md`).
- `backup/Dockerfile` — أدوات النسخ الاحتياطي (pg_dump، openssl، aws) كصورة، فلا يحتاج الخادم إلا Docker.
- `seaweedfs/s3.json` — هوية S3 لبيئة التطوير فقط.
- `ocr/` — حاوية OCR خاصة (Tesseract عربي+إنجليزي، poppler) على `127.0.0.1:58884`، تُشغَّل بـ`docker compose up -d ocr`. في الإنتاج: `HAYAT_OCR_PROVIDER=apps.documents.ocr.TesseractHttpOcrProvider` و`HAYAT_OCR_URL` (شبكة داخلية فقط). انظر `docs/OCR_EVALUATION.md`.

متغيرات الإنتاج المطلوبة: `DJANGO_SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`, `S3_*`, `DJANGO_ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `HAYAT_PUBLIC_BASE_URL=https://hayattek.com`, `EMAIL_*`, و`HAYAT_ENFORCE_MFA=true` (الافتراضي في prod).

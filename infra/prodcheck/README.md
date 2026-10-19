# تمرين الإنتاج المحلي (Production rehearsal)

يشغّل **نفس** حاويات الإنتاج (`infra/docker-compose.prod.yml`) على هذا الجهاز بأسرار مؤقتة وشهادة موقّعة ذاتياً، للتأكد من أن النسخة الإنتاجية تُبنى وتعمل قبل استئجار أي خادم. لا يُنشر شيء ولا يُتصل بأي خدمة خارجية.

```bash
python infra/prodcheck/generate.py          # أسرار مؤقتة في infra/prodcheck/.local (خارج git)
cd infra
export HAYAT_ENV_DIR=./prodcheck/.local HAYAT_CERT_DIR=./prodcheck/.local/certs \
       HAYAT_HTTP_BIND=127.0.0.1:58080 HAYAT_HTTPS_BIND=127.0.0.1:58443
docker compose -p hayat-prodcheck -f docker-compose.prod.yml -f prodcheck/docker-compose.prodcheck.yml up -d --build
docker compose -p hayat-prodcheck -f docker-compose.prod.yml -f prodcheck/docker-compose.prodcheck.yml exec api python manage.py ensure_bucket
curl -k --resolve hayattek.com:58443:127.0.0.1 https://hayattek.com:58443/api/health/ready
```

الإيقاف والحذف الكامل للتمرين: `docker compose -p hayat-prodcheck ... down -v`.

**لا تُستخدم ملفات `.local` على خادم حقيقي أبداً**؛ الخادم يولّد أسراره بنفسه.

# حياة — HAYAT Healthcare Network

شبكة صحية رقمية موحدة للقطاع الطبي الخاص في سوريا (البداية: محافظة الرقة).
لكل مريض ملف صحي واحد مستمر، يطّلع عليه الأطباء والمنشآت المشاركة **بموافقته**، مع سجل تدقيق كامل.

| الجزء | التقنية | المسار |
|---|---|---|
| API | Django 5.2 LTS + DRF + PostgreSQL 16 + Celery/Redis | `backend/` |
| الويب | Next.js 16 + TypeScript + Tailwind 4 | `apps/web/` |
| الموبايل | Expo (React Native) | `apps/mobile/` |
| عميل API مشترك | أنواع مولدة من OpenAPI + openapi-fetch | `packages/api-client/` |
| الوثائق | المعمارية، الأمن، القرارات، التقدم | `docs/` |

## التشغيل المحلي (Windows)

المتطلبات: Docker Desktop، Python 3.12 مع [uv](https://docs.astral.sh/uv/)، Node 20.9+ مع pnpm.

```powershell
# 1) البنية التحتية: PostgreSQL :55432، Redis :56379، S3 (SeaweedFS) :58333
copy .env.example .env
docker compose up -d

# 2) الـBackend
cd backend
uv sync
uv run python manage.py migrate
uv run python manage.py ensure_bucket
uv run python manage.py seed_demo            # بيانات اصطناعية فقط، يرفض العمل إن كان DEBUG=False
uv run python manage.py runserver 127.0.0.1:8100

# 3) الويب (نافذة أخرى، من جذر المستودع)
pnpm install
pnpm dev:web                                  # http://localhost:3100
```

> استخدم `127.0.0.1` وليس `localhost` في `.env` على Windows (localhost يجرب IPv6 أولاً فيتأخر الاتصال).

### حسابات التجربة (كلمة المرور: `Hayat-Demo-2026!`)

| الحساب | الدور |
|---|---|
| `admin@hayattek.test` | إدارة المنصة |
| `doctor@hayattek.test` | طبيب داخلية — مجمع الرقة الطبي |
| `doctor2@hayattek.test` | طبيبة قلبية + مديرة عيادة |
| `reception@hayattek.test` | استقبال المجمع |
| `manager@hayattek.test` | مدير المجمع (بلا وصول طبي) |
| `lab@hayattek.test` | فني مختبر الفرات |
| `patient@hayattek.test` | مريض تجريبي |

## الاختبارات

```powershell
cd backend
uv run pytest                     # اختبارات الصلاحيات والعزل وسيناريو القبول (20 خطوة)
uv run ruff check .

cd ..\apps\web
pnpm exec tsc --noEmit
pnpm test:e2e                     # Playwright: يتطلب تشغيل الـAPI والويب و seed_demo
```

## توليد عميل الـAPI بعد تعديل الـBackend

```powershell
cd backend; uv run python manage.py spectacular --file ../packages/api-client/openapi.yaml; cd ..
pnpm gen:api
```

## مبادئ لا يُتنازل عنها

1. **لا أحد يرى سجلاً طبياً إلا بعلاقة علاجية أو موافقة المريض.** الإدارة والاستقبال لا يرون السجلات.
2. **السجل المعتمد لا يُعدل بصمت.** التصحيح موثق بسبب ونسخة.
3. **سجل التدقيق محمي في قاعدة البيانات** (Trigger يمنع التعديل والحذف).
4. **لا بيانات مرضى حقيقية في التطوير.**
5. **ما لم يُنفذ يُقال إنه لم يُنفذ** — انظر `docs/PROGRESS.md`.

## الوثائق

[المتطلبات](docs/PRODUCT_REQUIREMENTS.md) · [المعمارية](docs/ARCHITECTURE.md) · [قاعدة البيانات](docs/DATABASE_SCHEMA.md) · [الـAPI](docs/API_CONTRACT.md) · [الأمن](docs/SECURITY_MODEL.md) · [القرارات](docs/DECISIONS.md) · [خطة التنفيذ](docs/IMPLEMENTATION_PLAN.md) · [دليل الواجهة](docs/FRONTEND_GUIDE.md) · [التقدم](docs/PROGRESS.md)

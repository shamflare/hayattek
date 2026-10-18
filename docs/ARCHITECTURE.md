# معمارية منصة حياة (HAYAT)

## نظرة عامة

```
                 ┌──────────────────────┐        ┌───────────────────────┐
  المتصفح ───────▶  Next.js (apps/web)   │        │  Expo App (apps/mobile)│
  (طبيب/مريض/     │  SSR + Client UI      │        │  Android / iOS         │
   إدارة)         │  rewrites /api/* ─────┼──┐     └──────────┬────────────┘
                 └──────────────────────┘  │                │ Bearer token
                                           ▼                ▼
                                 ┌─────────────────────────────────┐
                                 │  Django + DRF (backend/)        │
                                 │  Modular Monolith               │
                                 │  ┌───────────┐ ┌─────────────┐  │
                                 │  │ access/   │ │ audit/      │  │
                                 │  │ policy    │ │ append-only │  │
                                 │  └───────────┘ └─────────────┘  │
                                 └──┬──────────┬──────────┬────────┘
                                    │          │          │
                          ┌─────────▼──┐  ┌────▼────┐ ┌───▼──────────┐
                          │ PostgreSQL │  │  Redis  │ │ S3 (MinIO)   │
                          │  16        │  │ broker/ │ │ private      │
                          └────────────┘  │ cache   │ │ bucket       │
                                          └────┬────┘ └──────────────┘
                                               │
                                        ┌──────▼──────┐
                                        │ Celery      │ OCR، إشعارات،
                                        │ worker/beat │ معالجة ملفات
                                        └─────────────┘
```

## هيكل المستودع

```
hayattek/
├── backend/                  Django
│   ├── config/               settings (base/dev/test/prod)، urls، celery
│   ├── apps/
│   │   ├── core/             نماذج أساسية، UUIDv7، أخطاء، ترقيم، أدوات عربية
│   │   ├── accounts/         User، توكنات الموبايل، تسجيل الدخول، MFA
│   │   ├── organizations/    Organization، Membership، الدعوات، الاشتراكات
│   │   ├── practitioners/    Practitioner (هوية مهنية واحدة)، التحقق
│   │   ├── patients/         Patient، HealthCard، Registration، Guardian، تكرار
│   │   ├── access/           محرك الصلاحيات، AccessGrant، AccessRequest، OTP
│   │   ├── clinical/         Encounter، Condition، Allergy، RecordVersion
│   │   ├── medications/      الكتالوج، المفضلة، القوالب، الوصفات
│   │   ├── diagnostics/      طلبات التحليل والتصوير، تقارير المختبر والنتائج
│   │   ├── documents/        رفع الملفات، التخزين الخاص، OCR
│   │   ├── referrals/        الإحالات
│   │   ├── notifications/    إشعارات داخل التطبيق
│   │   └── audit/            AuditEvent (محمي بـTrigger)
│   ├── tests/                اختبارات التكامل والصلاحيات وسيناريو القبول
│   └── pyproject.toml        (uv)
├── apps/
│   ├── web/                  Next.js 16 + TypeScript + Tailwind v4
│   └── mobile/               Expo (React Native)
├── packages/
│   └── api-client/           أنواع TypeScript مولدة من OpenAPI + عميل fetch
├── infra/                    Dockerfiles، إعدادات nginx للإنتاج
├── docs/
├── docker-compose.yml        postgres، redis، minio (+ api/worker اختيارياً)
└── .env.example
```

**لماذا هذا الهيكل:** pnpm workspace يجمع `apps/web` و`apps/mobile` و`packages/api-client`، والـBackend مستقل تماماً بأدوات Python (uv). النتيجة أن كل طرف يمكن بناؤه ونشره منفصلاً.

## تدفق الطلب السريري

1. الواجهة ترسل الطلب مع الكوكي (ويب) أو `Authorization: Token ...` (موبايل)، ومعه `X-Hayat-Membership`.
2. `PracticeContextMiddleware`/الـAuthentication يبني `request.practice` بعد التحقق من العضوية.
3. الـViewSet يطلب من `access.policy` الـQuerySet المسموح (`visible_encounters(ctx, patient)`).
4. الإنشاء والتعديل يمر عبر `services.py` في كل وحدة (منطق الأعمال + transaction + audit).
5. `audit.record(...)` يكتب الحدث في نفس الـtransaction.

## حدود الوحدات

| الوحدة | تملك | تعتمد على |
|---|---|---|
| core | BaseModel، أدوات | — |
| accounts | User، AuthToken | core |
| organizations | Organization، Membership، Subscription | accounts |
| practitioners | Practitioner | accounts |
| patients | Patient، HealthCard، Registration | organizations |
| access | PracticeContext، AccessGrant، policy | patients، organizations |
| clinical / medications / diagnostics / documents / referrals | السجلات الطبية | access، patients |
| audit | AuditEvent | core (تستخدمه الكل) |

القاعدة: الوحدات السريرية **لا** تفحص الصلاحيات بنفسها بمنطق خاص، بل تستدعي `access.policy`.

## الأداء والشبكات الضعيفة

- ترقيم الصفحات (Cursor) في السجل الزمني، وتحميل 20 عنصراً في كل مرة.
- ملخص المريض endpoint واحد خفيف (`/patients/{id}/summary`) يُرجع كل ما يحتاجه الطبيب في طلب واحد.
- لا تحميل تلقائي للملفات: القائمة ترجع بيانات وصفية فقط، والملف يُطلب عند الضغط.
- ضغط gzip/brotli، وخطوط مستضافة ذاتياً عبر `next/font`.
- فهارس مركبة على `(patient_id, occurred_at)` لكل جداول السجلات.

## البيئات

| البيئة | الإعدادات | قاعدة البيانات |
|---|---|---|
| dev | `config.settings.dev` | PostgreSQL في Docker |
| test | `config.settings.test` | PostgreSQL (قاعدة اختبار مؤقتة) |
| prod | `config.settings.prod` | PostgreSQL مُدار، أسرار من متغيرات البيئة |

SQLite غير مدعوم (تُستخدم ميزات خاصة بـPostgreSQL مثل ArrayField وTriggers).

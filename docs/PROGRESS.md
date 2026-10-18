# سجل التقدم

> آخر تحديث: 2026-10-19 (نهاية المرحلة الثانية). هذا الملف يكفي لاستئناف العمل من جلسة جديدة.
> المتطلبات: المرحلة الأولى `info.md` · المرحلة الثانية `requirements/PHASE2_REQUIREMENTS.md` · الخطة `PHASE2_PLAN.md` · الجاهزية `PRODUCTION_READINESS.md`.

## الحالة باختصار

| المرحلة | الحالة |
|---|---|
| المرحلة الأولى (المنصة الأساسية، سيناريو 20 خطوة) | ✅ |
| A — تدقيق المشروع | ✅ (44 اختباراً كانت ناجحة عند البدء) |
| B — استكمال النواقص | ✅ مع حدود موثقة أدناه |
| C — المحفظة الآجلة | ✅ |
| D — المساعد الطبي الذكي | ✅ بمزود تجريبي (لا مزود حقيقي قبل الموافقة) |
| E — ربط الفوترة بالمساعد | ✅ |
| F — واجهات الويب والموبايل | ✅ الويب كامل؛ الموبايل مبني ومختبر على Expo web فقط |
| G — اختبارات شاملة | ✅ **166 اختبار خادم + 3 اختبارات E2E + 50 اختبار وحدة للموبايل** |
| H — مراجعة ما قبل الإنتاج | ✅ `PRODUCTION_READINESS.md` |

## الاختبارات (آخر تشغيل فعلي)
| المجموعة | الأمر | النتيجة |
|---|---|---|
| الخادم | `cd backend && uv run pytest tests apps --create-db` | **166 ناجح، 0 فاشل** |
| E2E (الويب الحقيقي ← Django ← PostgreSQL) | `cd apps/web && npx playwright test` | **3/3**: سيناريو المرحلة الثانية (25 خطوة)، مسار الطبيب، مسار الأشعة |
| الموبايل | `pnpm --filter @hayat/mobile test` | 50 ناجح |
| الجودة | `ruff check .` · `tsc --noEmit` (web, mobile) · `makemigrations --check` | نظيف |
| الأمن | `pip-audit` · `pnpm audit --prod` · `check --deploy` (prod) | لا ثغرات معروفة / لا تحذيرات |
| النسخ الاحتياطي | تمرين: نسخة مشفرة ← استعادة ← `check_restore` | integrity OK |

## ما أُنجز في المرحلة الثانية (الملفات الرئيسية)
| الميزة | الكود | الوثيقة |
|---|---|---|
| المحفظة الآجلة (Ledger، تسعير، دفعات، عكس، تسويات، مفتاح AI يدوي، تنبيهات، CSV/PDF، إيصالات) | `backend/apps/billing/`، `apps/web/src/app/app/admin/wallets/`، `app/app/wallet/`، `app/print/{receipt,billing}` | `POSTPAID_WALLET.md`, ADR-025 |
| المساعد الذكي (جلسات، موافقة، تسجيل WAV، تشفير، مزود تجريبي، استخراج سوري، مراجعة، اعتماد) | `backend/apps/scribe/`، `apps/web/src/components/scribe/`، `app/app/encounters/[id]/scribe/` | `AI_SCRIBE.md`, `AI_PROVIDER_EVALUATION.md`, ADR-026 |
| فحص البرمجيات الضارة (ClamAV، حجر صحي، فشل مغلق) | `backend/apps/documents/scanning.py` | ADR-023, `SECURITY_MODEL.md` §7 |
| الرسائل (Outbox، إعادة محاولة، حدود، حالة صادقة) | `backend/apps/notifications/` | ADR-024 |
| OCR (Tesseract محلي + مراجعة بشرية) | `backend/apps/documents/ocr*.py`، `infra/ocr/`، `app/app/documents/[id]/review` | `OCR_EVALUATION.md`, ADR-029 |
| DICOM (Orthanc خاص + عارض مراجعة) | `backend/apps/dicom/`، `components/imaging/dicom-viewer.tsx` | ADR-030/031 |
| دمج المكررات بمراجعة بشرية وتراجع | `backend/apps/patients/merge*.py`، `app/app/patients/duplicates` | ADR-027 |
| استيراد كتالوج الأدوية | `backend/apps/medications/catalog.py`، `app/app/admin/catalog` | ADR-028 |
| حساب تصوير + طباعة تقرير الأشعة | `seed_demo`، `app/print/imaging/[id]`، `e2e/imaging-flow.spec.ts` | |
| الموبايل: AI + المحفظة + عدم الاتصال | `apps/mobile/src/app/clinician/scribe*.tsx`، `wallet.tsx`، `lib/{recorder,wav,upload,offline}.ts` | `MOBILE_TEST_PLAN.md` |
| فرض MFA على الـAPI | `backend/apps/access/context.py` | `SECURITY_MODEL.md` §14 |
| النسخ والاستعادة، تعطيل الحسابات التجريبية، فحص الجاهزية | `infra/backup/`، `manage.py check_restore`، `disable_demo_accounts`، `/api/health/ready` | `PRODUCTION_READINESS.md` |

## غير مكتمل أو يحتاج قراراً (بصدق)
| البند | السبب |
|---|---|
| مزود AI حقيقي | الأهلية من سوريا غير مؤكدة + موافقة قانونية + تكلفة — قرارك |
| دقة التفريغ الصوتي للهجة السورية | لم تُقس (تحتاج مزوداً حقيقياً وتسجيلات اصطناعية بأصوات ممثلين) |
| مزود SMS وSMTP | تكلفة/عقد — قرارك؛ البنية جاهزة ولا تدّعي الإرسال |
| كتالوج أدوية حقيقي | مصدر مرخّص — قرارك |
| اختبار الموبايل على هاتف | لا يوجد جهاز/محاكي على هذا الحاسوب — اتبع `MOBILE_TEST_PLAN.md` |
| OCR للأرقام العربية الهندية | ضعيف في Tesseract؛ تُترك فارغة للمراجع |
| عارض DICOM | للمراجعة فقط، غير معتمد للتشخيص؛ لا MPR/قياسات/استقبال من الأجهزة |
| رموز استرداد MFA | غير منفذة (إعادة الضبط من إدارة المنصة) |
| رابط ملف مريض مدموج | يعيد 404 بدل التحويل للملف الباقي |
| طباعة إيصال من الموبايل | من الويب فقط |
| اختبار اختراق مستقل، المراجعة القانونية، الاستضافة | قبل الإطلاق العام |

## ملاحظات تشغيل مهمة
- المنافذ المحلية: Postgres 55432، Redis 56379، S3 58333، ClamAV 53310، OCR 58884، Orthanc 58042، Django 8100، Next 3100، Expo 8081.
- `localhost` بطيء على Windows لقاعدة البيانات — استخدم `127.0.0.1`.
- المهام الخلفية تعمل مباشرة في التطوير (`HAYAT_CELERY_EAGER=true`).
- حد تسجيل الدخول في التطوير 60/دقيقة (الإنتاج 5).
- اختبارات متوازية: `HAYAT_TEST_DB=<اسم>` لقاعدة اختبار منفصلة.
- قاعدة التطوير فيها بيانات اصطناعية متراكمة من الاختبارات (زيارات مسودة، جلسات AI، رسوم تجريبية على محفظة `doctor@`) — آمنة ويمكن إعادة إنشائها.

## الخطوة التالية المقترحة
1. قراراتك: مزود AI، مزود SMS/SMTP، مصدر الكتالوج، الاستضافة + المراجعة القانونية.
2. تنفيذ `MOBILE_TEST_PLAN.md` على هاتف أندرويد وآيفون.
3. تقييم مزود AI ببيانات اصطناعية (الخطة جاهزة في `AI_PROVIDER_EVALUATION.md` §4).
4. اختبار اختراق مستقل ثم تجربة مغلقة.

# عقد الـAPI

- **المرجع الآلي الكامل:** OpenAPI 3 في `packages/api-client/openapi.yaml` (يُولد من الكود)، وواجهة تفاعلية على `http://127.0.0.1:8100/api/docs/`.
- **العميل المولد:** `@hayat/api-client` (أنواع TypeScript + `openapi-fetch`) يستخدمه الويب والموبايل.
- بعد أي تعديل في الـBackend: `cd backend && .venv/Scripts/python manage.py spectacular --file ../packages/api-client/openapi.yaml` ثم `pnpm gen:api`.

## اصطلاحات عامة

| البند | القاعدة |
|---|---|
| البادئة | `/api/v1/` |
| المصادقة | ويب: كوكي جلسة `hayat_session` + هيدر `X-CSRFToken` للطلبات غير الآمنة. موبايل: `Authorization: Token <token>` |
| سياق العمل | `X-Hayat-Membership: <membership_id>` لكل طلب يقوم به موظف منشأة. **بدون الهيدر** يُعامل الطلب كطلب من المريض أو الوصي |
| المعرفات | UUID في كل المسارات |
| الترقيم | `?page=&page_size=` ← `{count, next, previous, results}`؛ السجل الزمني بالمؤشر `?before=` |
| الأخطاء | `{ "code": "machine_code", "message": "رسالة عربية", "fields"?: {...} }` |
| الحالات | 400 تحقق/قاعدة عمل · 401 غير مسجل · 403 دور غير مسموح · **404 لسجل غير موجود أو غير مصرح** (لا نكشف الوجود) · 409 تعارض حالة (سجل معتمد، تكرار محتمل) · 429 تجاوز المعدل |
| التواريخ | ISO 8601 UTC؛ العرض بتوقيت دمشق في الواجهات |

## المجموعات الرئيسية

| المجموعة | المسارات | من يستخدمها |
|---|---|---|
| المصادقة | `auth/csrf`, `auth/login`, `auth/token`, `auth/logout`, `auth/me`, `auth/password/*`, `auth/mfa/*` | الجميع |
| إدارة المنصة | `admin/organizations[/{id}/members|set-status]`, `admin/practitioners/{id}/verification`, `admin/users`, `admin/plans`, `admin/subscriptions`, `admin/audit`, `admin/stats`, `admin/join-requests` | `is_platform_admin` |
| المنشأة | `org/profile`, `org/members`, `org/departments` | `org_admin` |
| الدليل | `directory/organizations`, `directory/practitioners` | أي مستخدم مسجل |
| المرضى (طاقم) | `patients` (بحث/إنشاء)، `patients/{id}`، `patients/check-duplicates`، `patients/identify`، `patients/register`، `patients/{id}/card` | استقبال، طبيب، مختبر |
| الموافقات (طاقم) | `access` (حالة المريض)، `access/in-person`، `access/requests`، `access/requests/{id}/verify-otp`، `access-grants` | طبيب معتمد |
| المريض | `me/patients/{id}` (+`card`, `card/replace`, `reported`, `corrections`)، `me/sharing/grants|requests|access-log` | المريض والوصي |
| السجلات | `clinical/encounters|conditions|allergies`، `prescriptions`، `diagnostics/requests|lab-reports|imaging-reports`، `documents`، `referrals` — كلها: `GET ?patient=`، `GET {id}`، `POST`، `PATCH {id}` (مسودة)، `POST {id}/finalize`، `POST {id}/amend {reason, changes}`، `POST {id}/entered-in-error {reason}`، `GET {id}/versions` | حسب السياسة |
| خاص | `clinical/summary?patient=`، `clinical/timeline?patient=&before=&types=`، `prescriptions/{id}/print`، `diagnostics/requests/incoming`، `diagnostics/requests/{id}/fulfillment`، `diagnostics/lab-reports/trend`، `documents/{id}/download`، `referrals/inbox|sent|{id}/respond`، `medications/catalog|favorites|templates|sig-preview` | — |
| عام (بدون دخول) | `public/cards/{token}` (صالحة أم لا فقط)، `public/prescriptions/{code}` (رقم، تاريخ، جهة، طبيب، حالة — بلا أدوية)، `public/join-requests` | الجمهور |

## مثال: سيناريو المسح والموافقة

```http
POST /api/v1/patients/identify
X-Hayat-Membership: 01a1…
{"card_token": "Qm9…"}
→ 200 {"patient": {...هوية مختصرة...}, "access": {"registered": false, "network_scopes": [], "can_view_clinical": false, "can_author": false}}

POST /api/v1/access/requests
{"card_token": "Qm9…", "scopes": ["summary","encounters"], "hours": 24, "channel": "otp"}
→ 201 {"id": "…", "status": "pending", ...}      # SMS إلى المريض

POST /api/v1/access/requests/{id}/verify-otp
{"otp": "482913"}
→ 200 {"scopes": ["encounters","summary"], "expires_at": "...", "method": "otp", ...}
```

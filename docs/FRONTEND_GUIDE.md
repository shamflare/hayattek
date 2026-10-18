# دليل واجهة الويب (apps/web)

> مرجع لكل من يكتب صفحات في `apps/web`. الهدف: منتج موحد الشكل والسلوك، عربي أولاً، بسيط للطبيب والمريض.

## التشغيل

```bash
docker compose up -d                       # postgres, redis, s3
cd backend && .venv/Scripts/python manage.py runserver 127.0.0.1:8100
pnpm dev:web                               # http://localhost:3100
```
- Next.js **16** (App Router + Turbopack). اقرأ `apps/web/node_modules/next/dist/docs/` عند الشك. `middleware` اسمه الآن `proxy` (`src/proxy.ts`)، و`params` في Server Components أصبح Promise. صفحات التطبيق كلها Client Components وتستخدم `useParams()`.
- حسابات تجريبية (كلمة المرور `Hayat-Demo-2026!`): `admin@`, `doctor@`, `doctor2@`, `reception@`, `manager@`, `lab@`, `patient@` — النطاق `hayattek.test`.
- لقطة شاشة للتحقق البصري: `MSYS_NO_PATHCONV=1 node scripts/shot.mjs /app/clinic out.png --login doctor@hayattek.test [--mobile] [--dark] [--full]`.

## البنية

```
src/app/(marketing)/      صفحات عامة (الرئيسية، للأطباء، الخصوصية، الشروط)
src/app/(auth)/           تسجيل الدخول واستعادة كلمة المرور
src/app/app/              التطبيق بعد الدخول (AppShell)
  clinic/ patients/ encounters/ prescriptions/ scan/ medications/ referrals/   الطبيب والاستقبال
  lab/                    المختبر ومركز التصوير
  org/                    مدير المنشأة
  admin/                  إدارة المنصة
  me/                     بوابة المريض
  notifications/ settings/
src/app/print/            صفحات الطباعة (بدون AppShell)
src/app/c/[token]         ما يراه من يمسح البطاقة دون تسجيل دخول
src/app/verify/[code]     التحقق العام من الوصفة
src/components/ui/        مكونات أساسية مشتركة — لا تُعدل إلا بحذر
src/components/app/       AppShell، PageHeader، CommandPalette
src/components/<area>/    مكونات خاصة بمنطقة (clinical/, patient/, admin/, lab/)
src/lib/                  api.ts, session.tsx, format.ts, i18n/, hooks.ts
```

## جلب البيانات

- **دائماً** عبر العميل المولد: `api.GET("/api/v1/...", { params: { query, path } })` ثم `unwrap(...)` داخل TanStack Query.
- `api` يرسل `X-Hayat-Membership` (سياق المنشأة) و`X-CSRFToken` تلقائياً. **بوابة المريض `/app/me/*` تستخدم `patientApi`** (بدون سياق منشأة)، لأن الخادم يعامل الطلب بلا سياق كطلب من المريض أو الوصي.
- رفع الملفات: `uploadDocument(formData, withContext)`، وعرضها: `fetchDocumentBlob(id, withContext)` ثم Object URL.
- الأخطاء: `errorMessage(err)` يعيد رسالة عربية من الخادم، وتُعرض في `toast.error(...)` من `sonner` أو داخل الحقل.
- مفاتيح الاستعلام: `["patients", id]`, `["summary", patientId]`, `["timeline", patientId]`… وبعد أي تعديل نفّذ `queryClient.invalidateQueries`.
- الأنواع: `Schemas["EncounterWrite"]` وغيرها من `@/lib/api`. بعد تعديل الـBackend: `cd backend && .venv/Scripts/python manage.py spectacular --file ../packages/api-client/openapi.yaml && pnpm gen:api`.

## القواعد الإلزامية

1. **العربية افتراضياً وRTL**. استخدم `ms-/me-/ps-/pe-/start-/end-` وليس `ml/mr/left/right`.
2. القيم الطبية والأرقام والتواريخ داخل `<span className="num">` (أرقام لاتينية، اتجاه LTR معزول).
3. التواريخ عبر `formatDate/formatDateTime/relativeTime` (توقيت دمشق). الأعمار عبر `ageLabel`.
4. أسماء القيم المرمّزة عبر `label("scopes", value)` وأخواتها من `lib/i18n`. لا تكتب جداول ترجمة مكررة.
5. كل صفحة لها: حالة تحميل (`Skeleton`/`SkeletonList`)، وحالة فارغة (`EmptyState`)، وحالة خطأ (`ErrorState`).
6. لا تُظهر زراً لوظيفة غير موجودة في الـAPI. ما لم يُنفذ يُكتب صراحة "قريباً".
7. الأمان: لا تخزن بيانات طبية في `localStorage`. الصلاحيات تُفرض في الخادم؛ الواجهة تخفي ما لا يُسمح به فقط لتحسين التجربة.
8. Mobile first: كل صفحة تعمل على عرض 390px. الشريط السفلي يغطي 64px أسفل الشاشة (المحتوى له `pb-28`).
9. الوضع الداكن: استخدم الرموز اللونية (`bg-elevated`, `bg-sunken`, `text-muted`, `border-line`, `brand-*`) ولا تستخدم ألواناً ثابتة مثل `bg-white`.
10. حوارات التأكيد للعمليات غير القابلة للتراجع (`ConfirmDialog`)، وToast للنجاح.

## المكونات

| المكون | الاستخدام |
|---|---|
| `Button` (`primary/secondary/outline/ghost/danger`, `loading`, `asChild`) | كل الأزرار |
| `Input`, `Textarea`, `Select`, `Field`, `ChoiceChips` | النماذج. `ChoiceChips` للاختيارات السريعة (أوقات الجرعة، النطاقات) |
| `Card`, `CardHeader`, `CardBody`, `Badge`, `Avatar`, `Kbd`, `Divider` | البطاقات |
| `Skeleton`, `SkeletonList`, `EmptyState`, `ErrorState` | الحالات |
| `Dialog`, `DialogContent`, `ConfirmDialog` | النوافذ (Bottom sheet على الموبايل تلقائياً) |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | التبويبات |
| `RecordStatusBadge`, `FulfillmentBadge`, `InterpretationBadge`, `SourceBadge` | حالات السجلات |
| `PageHeader` | ترويسة كل صفحة (`title`, `description`, `actions`, `back`) |

الأيقونات من `lucide-react` فقط.

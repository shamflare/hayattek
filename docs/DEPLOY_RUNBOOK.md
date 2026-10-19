# دليل النشر — التجربة الأولى (Pilot)

> الخادم: Hetzner Cloud `hayattek` (Falkenstein)، `188.245.161.73`، Ubuntu 24.04. النطاق على Cloudflare.
> **بيانات اصطناعية فقط.** الدخول: `ssh -i ~/.ssh/hayattek_ed25519 root@188.245.161.73` (مفتاح فقط، كلمات المرور معطّلة).

## الحالة الحالية (2026-10-19)
| البند | الحالة |
|---|---|
| تأمين الخادم: تحديثات تلقائية، UFW (22/80/443 فقط)، fail2ban، SSH بالمفتاح فقط، swap 2GB، Docker | ✅ |
| الأسرار: وُلّدت **على الخادم** في `/srv/hayat` (0600)، لا تغادره | ✅ |
| الكود: `/srv/hayat/app` (git clone من GitHub) | ✅ |
| الصور: تُبنى على جهاز التطوير وتُنقل (`docker save \| ssh docker load`) — الخادم صغير لا يبني | ✅ |
| الخدمات: postgres, redis, s3, api, worker, beat, web | ✅ تعمل |
| DNS (Cloudflare، DNS only) ← شهادة Let's Encrypt ← nginx | ⏳ |
| حساب مدير المنصة الحقيقي + MFA | ⏳ |
| النسخ الاحتياطي اليومي + نسخة خارج الخادم | ⏳ |
| البريد SMTP | ⏳ قرار المالك |

## حدود الخادم الصغير (CPX02: 1 vCPU / 1 GB)
- **لا يعمل:** ClamAV وOCR وOrthanc (`profiles: [full]` في `infra/pilot/docker-compose.pilot.yml`).
- **أثره:** رفع المستندات يبقى في الحجر (`pending`) ولا يُفتح — فشل مغلق، لا يمر ملف دون فحص. OCR وعارض DICOM متوقفان.
- **عند الترقية (Rescale ≥ 8 GB):** `docker compose ... --profile full up -d` ثم في `/srv/hayat/prod.env`:
  `HAYAT_OCR_PROVIDER=apps.documents.ocr.TesseractHttpOcrProvider`، `HAYAT_OCR_URL=http://ocr:8884`، `ORTHANC_URL=http://orthanc:8042` (+ المستخدم وكلمة المرور من `orthanc.env`).

## أوامر التشغيل (على الخادم)
```bash
cd /srv/hayat/app/infra
C="docker compose -p hayat -f docker-compose.prod.yml -f pilot/docker-compose.pilot.yml"
$C ps                                   # الحالة
$C logs -f --tail 100 api               # السجلات (بلا بيانات صحية)
$C up -d --no-build                     # تشغيل/تحديث
$C exec api python manage.py check_restore
```

## تحديث الإصدار
1. على جهاز التطوير: بناء الصور ووسمها `hayattek/backend:pilot`، `hayattek/web:pilot`، `hayattek/backup:pilot`.
2. `docker save hayattek/<img>:pilot | gzip -1 | ssh root@188.245.161.73 'gunzip | docker load'`
3. على الخادم: `cd /srv/hayat/app && git pull` ثم `$C up -d --no-build` (الترحيلات تُطبَّق تلقائياً عند إقلاع api).

## ملاحظات
- `s3.json` يجب أن يملكه uid 1000 (مستخدم SeaweedFS)؛ `generate.py` يضبط ذلك عند التشغيل كـ root.
- Cloudflare في وضع **DNS only**: Let's Encrypt عبر HTTP-01، والخادم يرى عنوان المستخدم الحقيقي (حد محاولات الدخول لكل مستخدم). تفعيل وكيل Cloudflare لاحقاً يتطلب `set_real_ip_from` لنطاقات Cloudflare و`real_ip_header CF-Connecting-IP` في nginx أولاً.
- عبارة مرور النسخ الاحتياطي `/srv/hayat/backup_passphrase` يجب أن تُحفظ أيضاً **خارج الخادم** (مدير كلمات مرور المالك)، وإلا فالنسخ عديمة الفائدة إن فُقد الخادم.

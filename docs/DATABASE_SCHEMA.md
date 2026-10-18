# مخطط قاعدة البيانات

PostgreSQL 16. كل الجداول تستخدم مفتاحاً أساسياً `UUIDv7` وحقلي `created_at/updated_at` (من `core.BaseModel`)، ما عدا `audit_auditevent` الذي يحمل `occurred_at`. الامتداد `pg_trgm` مفعّل للبحث العربي التقريبي.

> الكود هو المرجع النهائي: `backend/apps/*/models.py`. هذه الوثيقة تشرح البنية والقيود والمقابل في FHIR.

## الهوية والمنشآت

| الجدول | الحقول الأساسية | قيود وفهارس | FHIR |
|---|---|---|---|
| `accounts_user` | email (فريد، اختياري)، phone (فريد، اختياري، E.164)، full_name، is_platform_admin، mfa_enabled/mfa_secret، failed_login_count، locked_until، must_change_password | يجب وجود email أو phone | — |
| `accounts_devicetoken` | user، key_hash (SHA-256، فريد)، prefix، device_name، expires_at، revoked_at، last_used_at | يُخزن الـhash فقط | — |
| `organizations_organization` | name، kind (clinic/medical_center/hospital/laboratory/imaging_center)، status، governorate، city، address، phone، logo، print_footer | فهرس (kind, status) | Organization |
| `organizations_department` | organization، name | فريد (organization, name) | Organization.partOf |
| `organizations_membership` | user، organization، roles[] (ArrayField)، title، department، status | فريد (user, organization) | PractitionerRole |
| `organizations_subscriptionplan` / `subscription` | الخطة، الحالة، التواريخ | — | — |
| `organizations_joinrequest` | بيانات تواصل منشأة تريد الانضمام | لا بيانات مرضى | — |
| `practitioners_practitioner` | user (1:1)، display_name، specialty، license_number، verification_status، verified_by/at | هوية مهنية واحدة لكل مستخدم | Practitioner |

## المرضى

| الجدول | الحقول | قيود | FHIR |
|---|---|---|---|
| `patients_patient` | health_number (10 أرقام + Luhn، فريد)، الأسماء الأربعة + اسم الأم، full_name_en، name_search (مطبّع)، sex، birth_date + birth_date_precision، phone، national_id (اختياري)، العنوان، الطوارئ، user (حساب المريض)، status، merged_into | GIN trigram على name_search؛ الهاتف غير فريد (عائلات تتشارك الهاتف) | Patient |
| `patients_healthcard` | patient، token (عشوائي 128-bit)، status، revoked_at/reason | **بطاقة فعالة واحدة لكل مريض** (unique جزئي) | Patient.identifier |
| `patients_patientregistration` | patient، organization، local_file_number، status، last_visit_at | فريد (patient, organization) | — |
| `patients_patientguardian` | guardian (user)، patient، relationship، can_view_records، can_manage_sharing، valid_until، revoked_at | فريد (guardian, patient) | RelatedPerson |
| `patients_patientreportedinfo` | patient، kind، text، reported_by | يُعرض دائماً كـ"صرّح به المريض" | Observation (patient-reported) |
| `patients_correctionrequest` | patient، target_type/id، message، status | — | Task |

## الموافقات

| الجدول | الحقول | قيود | FHIR |
|---|---|---|---|
| `access_accessgrant` | patient، organization، practitioner (اختياري)، scopes[]، purpose، method، starts_at، expires_at، granted_by، attestation، revoked_at/by | CHECK expires_at > starts_at؛ فهرس (patient, organization, expires_at) | Consent |
| `access_accessrequest` | patient، organization، practitioner، requested_by، scopes[]، duration_hours، status، otp_hash، otp_expires_at، otp_attempts، grant | OTP مخزن كـhash | Consent (proposed) |

## السجلات الطبية — حقول مشتركة (`ClinicalRecord`)

`patient`, `organization`, `author` (user), `practitioner`, `author_role`, `status` (draft/final/amended/entered_in_error), `source` (clinician/laboratory/imaging/patient/document_import), `occurred_at`, `finalized_at`, `version`, `amended_at`, `status_reason` — تقابل FHIR `Provenance` و`status`.

| الجدول | حقول خاصة | FHIR |
|---|---|---|
| `clinical_encounter` | encounter_type، reason، complaint، history، examination، vitals (JSON مضبوط)، assessment، plan، notes، follow_up_date/note | Encounter + ClinicalImpression |
| `clinical_condition` | encounter، code (ICD-10)، display، category (encounter_diagnosis/problem_list/past_history)، clinical_status، onset_date | Condition |
| `clinical_allergy` | encounter، substance، category، reaction، severity، is_active | AllergyIntolerance |
| `clinical_recordversion` | record_type، record_id، version، snapshot (JSON)، changed_by، reason | Provenance (غير قابل للتعديل) |
| `medications_prescription` | encounter، number (فريد)، verification_code (فريد)، diagnosis_text، notes، print_count | MedicationRequest (group) |
| `medications_prescriptionitem` | لقطة الدواء (name/strength/form)، dose_amount/unit، route، schedule_type + times_of_day[] / times_per_day / interval_hours / interval_days / weekdays[] / as_needed_reason، meal_relation، duration/end_date، quantity، instructions | MedicationRequest.dosageInstruction |
| `diagnostics_servicerequest` | kind (lab/imaging)، number، priority، performer_organization، clinical_notes، fulfillment_status | ServiceRequest |
| `diagnostics_servicerequestitem` | lab_test، modality، body_site، description | ServiceRequest.code |
| `diagnostics_labreport` | service_request، title، specimen_collected_at، conclusion، external_lab_name | DiagnosticReport |
| `diagnostics_labobservation` | test، name، value_numeric/value_text، unit، reference_low/high/text، interpretation، method | Observation |
| `diagnostics_imagingreport` | service_request، modality، body_site، title، findings، impression | DiagnosticReport (imaging) |
| `documents_clinicaldocument` | category، title، file (مفتاح تخزين خاص)، original_filename، mime_type (من magic bytes)، size_bytes، sha256، scan_status، روابط (encounter/lab_report/imaging_report) | DocumentReference |
| `documents_ocrresult` | document، provider، status، text، extracted (JSON)، mean_confidence، reviewed_at | — (اقتراح للمراجعة فقط) |
| `referrals_referral` | encounter، target_organization/practitioner/specialty، reason، priority، shared_scopes[]، patient_consented، state، response_note | ServiceRequest (referral) |

فهارس مركبة `(patient_id, occurred_at DESC)` على الزيارات والوصفات والتقارير والمستندات لفتح الملف بسرعة.

## الكتالوجات

| الجدول | ملاحظات |
|---|---|
| `medications_medication` | name، brand_name، active_ingredient (فارغ ما لم يكن موثقاً)، strength، dosage_form، unit، default_route، source (synthetic_test/imported/practitioner)، search_text (GIN trigram) |
| `medications_medicationfavorite` | practitioner + medication (فريد)، position، preset (إعدادات الطبيب نفسه)، use_count |
| `medications_prescriptiontemplate` | practitioner، name، items (JSON — تُنسخ إلى الوصفة ولا تُربط بها) |
| `diagnostics_labtesttype` | code (فريد)، name_ar/en، category، specimen — **بلا مجالات مرجعية** (تأتي من المختبر) |

## الإشعارات والتدقيق

| الجدول | ملاحظات |
|---|---|
| `notifications_notification` | user، kind، title، body (عام دون تفاصيل طبية)، link، read_at |
| `audit_auditevent` | actor_id، membership_id، organization_id، action، outcome، target_type/id، patient_id، ip_address، user_agent، request_id، metadata — **أعمدة UUID بدون FK** و**Trigger يمنع UPDATE/DELETE/TRUNCATE** |

## اختلافات موثقة عن FHIR

- الزيارة تجمع Encounter مع الملاحظة السريرية في جدول واحد للبساطة؛ التصدير إلى FHIR سيولد `Encounter` + `ClinicalImpression`.
- جرعات الوصفة منظمة بحقول خاصة بالواقع المحلي (صباحاً/ظهراً/مساءً/قبل النوم) تُحوّل إلى `Timing` عند التصدير.
- لا يوجد FHIR Server في الإصدار الأول.

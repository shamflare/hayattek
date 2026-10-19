"""Starter catalog of commonly ordered laboratory tests (names only — reference ranges always
come from each laboratory's report, §10). Idempotent by code; existing rows get the curated
names/categories, nothing is deleted."""

from django.db import migrations

# (code, Arabic name, English name, category, specimen)
LAB_TESTS = [
    # دمويات
    ("CBC", "تعداد دم كامل", "Complete blood count (CBC)", "دمويات", "دم"),
    ("HB", "خضاب الدم", "Hemoglobin", "دمويات", "دم"),
    ("PCV", "الهيماتوكريت", "Hematocrit (PCV)", "دمويات", "دم"),
    ("PLT", "تعداد الصفيحات", "Platelet count", "دمويات", "دم"),
    ("WBC-DIFF", "صيغة الكريات البيض", "WBC differential", "دمويات", "دم"),
    ("RETIC", "الشبكيات", "Reticulocyte count", "دمويات", "دم"),
    ("ESR", "سرعة التثفل", "Erythrocyte sedimentation rate (ESR)", "دمويات", "دم"),
    ("BLOOD-FILM", "لطاخة دم محيطي", "Peripheral blood film", "دمويات", "دم"),
    ("ABO-RH", "زمرة الدم والعامل الريزوسي", "Blood group & Rh", "دمويات", "دم"),
    ("COOMBS-D", "كومبس مباشر", "Direct Coombs test", "دمويات", "دم"),
    ("COOMBS-I", "كومبس غير مباشر", "Indirect Coombs test", "دمويات", "دم"),
    ("HB-ELEC", "رحلان الخضاب", "Hemoglobin electrophoresis", "دمويات", "دم"),
    ("G6PD", "خميرة G6PD", "G6PD", "دمويات", "دم"),
    ("SICKLE", "اختبار المنجلية", "Sickling test", "دمويات", "دم"),
    # سكر
    ("FBS", "سكر صيامي", "Fasting blood glucose", "سكر", "مصل"),
    ("RBS", "سكر عشوائي", "Random blood glucose", "سكر", "مصل"),
    ("PPBS", "سكر بعد الطعام بساعتين", "2-hour postprandial glucose", "سكر", "مصل"),
    ("HBA1C", "الخضاب السكري", "HbA1c", "سكر", "دم"),
    ("OGTT", "اختبار تحمل السكر الفموي", "Oral glucose tolerance test", "سكر", "مصل"),
    ("INSULIN", "أنسولين صيامي", "Fasting insulin", "سكر", "مصل"),
    ("C-PEP", "الببتيد C", "C-peptide", "سكر", "مصل"),
    # وظائف كلية
    ("UREA", "بولة", "Urea", "وظائف كلية", "مصل"),
    ("BUN", "آزوت البولة", "Blood urea nitrogen (BUN)", "وظائف كلية", "مصل"),
    ("CREAT", "كرياتينين", "Creatinine", "وظائف كلية", "مصل"),
    ("EGFR", "معدل الرشح الكبي المقدّر", "eGFR", "وظائف كلية", "مصل"),
    ("URIC", "حمض البول", "Uric acid", "وظائف كلية", "مصل"),
    ("CRCL-24", "تصفية الكرياتينين (بول 24 ساعة)", "24-hour creatinine clearance", "وظائف كلية", "بول"),
    ("PROT-24", "بروتين بول 24 ساعة", "24-hour urine protein", "وظائف كلية", "بول"),
    ("UACR", "نسبة الألبومين/الكرياتينين في البول", "Urine albumin/creatinine ratio", "وظائف كلية", "بول"),
    ("CYSC", "سيستاتين C", "Cystatin C", "وظائف كلية", "مصل"),
    # وظائف كبد
    ("ALT", "ALT (GPT)", "Alanine aminotransferase (ALT)", "وظائف كبد", "مصل"),
    ("AST", "AST (GOT)", "Aspartate aminotransferase (AST)", "وظائف كبد", "مصل"),
    ("ALP", "الفوسفاتاز القلوية", "Alkaline phosphatase (ALP)", "وظائف كبد", "مصل"),
    ("GGT", "GGT", "Gamma-glutamyl transferase (GGT)", "وظائف كبد", "مصل"),
    ("TBIL", "بيليروبين كلي", "Total bilirubin", "وظائف كبد", "مصل"),
    ("DBIL", "بيليروبين مباشر", "Direct bilirubin", "وظائف كبد", "مصل"),
    ("TP", "بروتين كلي", "Total protein", "وظائف كبد", "مصل"),
    ("ALB", "ألبومين", "Albumin", "وظائف كبد", "مصل"),
    ("LDH", "LDH", "Lactate dehydrogenase (LDH)", "وظائف كبد", "مصل"),
    ("AMYL", "أميلاز", "Amylase", "وظائف كبد", "مصل"),
    ("LIPASE", "ليباز", "Lipase", "وظائف كبد", "مصل"),
    ("NH3", "أمونيا", "Ammonia", "وظائف كبد", "بلازما"),
    # شحوم
    ("LIPID", "شحوم الدم الكاملة", "Lipid profile", "شحوم", "مصل"),
    ("CHOL", "كولسترول كلي", "Total cholesterol", "شحوم", "مصل"),
    ("TG", "شحوم ثلاثية", "Triglycerides", "شحوم", "مصل"),
    ("HDL", "HDL", "HDL cholesterol", "شحوم", "مصل"),
    ("LDL", "LDL", "LDL cholesterol", "شحوم", "مصل"),
    ("LPA", "ليبوبروتين (a)", "Lipoprotein (a)", "شحوم", "مصل"),
    # شوارد ومعادن
    ("NA", "صوديوم", "Sodium", "شوارد ومعادن", "مصل"),
    ("K", "بوتاسيوم", "Potassium", "شوارد ومعادن", "مصل"),
    ("CL", "كلور", "Chloride", "شوارد ومعادن", "مصل"),
    ("CA", "كالسيوم", "Calcium", "شوارد ومعادن", "مصل"),
    ("ICA", "كالسيوم متشرد", "Ionized calcium", "شوارد ومعادن", "دم"),
    ("PHOS", "فوسفور", "Phosphorus", "شوارد ومعادن", "مصل"),
    ("MG", "مغنيزيوم", "Magnesium", "شوارد ومعادن", "مصل"),
    ("ZN", "زنك", "Zinc", "شوارد ومعادن", "مصل"),
    ("ABG", "غازات الدم الشرياني", "Arterial blood gases", "شوارد ومعادن", "دم شرياني"),
    # فيتامينات وحديد
    ("FE", "حديد المصل", "Serum iron", "فيتامينات وحديد", "مصل"),
    ("TIBC", "سعة ربط الحديد الكلية", "TIBC", "فيتامينات وحديد", "مصل"),
    ("FERR", "فيريتين", "Ferritin", "فيتامينات وحديد", "مصل"),
    ("TSAT", "نسبة إشباع الترانسفرين", "Transferrin saturation", "فيتامينات وحديد", "مصل"),
    ("VITD", "فيتامين D", "25-OH vitamin D", "فيتامينات وحديد", "مصل"),
    ("B12", "فيتامين B12", "Vitamin B12", "فيتامينات وحديد", "مصل"),
    ("FOLATE", "حمض الفوليك", "Folate", "فيتامينات وحديد", "مصل"),
    # هرمونات الدرق
    ("TSH", "TSH", "Thyroid stimulating hormone (TSH)", "هرمونات الدرق", "مصل"),
    ("FT4", "FT4", "Free T4", "هرمونات الدرق", "مصل"),
    ("FT3", "FT3", "Free T3", "هرمونات الدرق", "مصل"),
    ("T4", "T4 كلي", "Total T4", "هرمونات الدرق", "مصل"),
    ("T3", "T3 كلي", "Total T3", "هرمونات الدرق", "مصل"),
    ("ANTI-TPO", "أضداد TPO", "Anti-TPO antibodies", "هرمونات الدرق", "مصل"),
    ("ANTI-TG", "أضداد التيروغلوبولين", "Anti-thyroglobulin antibodies", "هرمونات الدرق", "مصل"),
    # هرمونات
    ("BHCG", "هرمون الحمل في الدم (β-hCG)", "Serum β-hCG", "هرمونات", "مصل"),
    ("FSH", "FSH", "Follicle stimulating hormone (FSH)", "هرمونات", "مصل"),
    ("LH", "LH", "Luteinizing hormone (LH)", "هرمونات", "مصل"),
    ("PRL", "برولاكتين", "Prolactin", "هرمونات", "مصل"),
    ("E2", "إستراديول", "Estradiol (E2)", "هرمونات", "مصل"),
    ("PROG", "بروجسترون", "Progesterone", "هرمونات", "مصل"),
    ("TESTO", "تستوستيرون كلي", "Total testosterone", "هرمونات", "مصل"),
    ("AMH", "AMH", "Anti-Müllerian hormone (AMH)", "هرمونات", "مصل"),
    ("CORT", "كورتيزول صباحي", "Morning cortisol", "هرمونات", "مصل"),
    ("PTH", "هرمون جارات الدرق", "Parathyroid hormone (PTH)", "هرمونات", "مصل"),
    ("GH", "هرمون النمو", "Growth hormone", "هرمونات", "مصل"),
    ("DHEAS", "DHEA-S", "DHEA sulfate", "هرمونات", "مصل"),
    # تخثر
    ("PT", "زمن البروثرومبين", "Prothrombin time (PT)", "تخثر", "بلازما"),
    ("INR", "INR", "INR", "تخثر", "بلازما"),
    ("APTT", "PTT", "Activated partial thromboplastin time (aPTT)", "تخثر", "بلازما"),
    ("FIB", "فيبرينوجين", "Fibrinogen", "تخثر", "بلازما"),
    ("DDIMER", "D-Dimer", "D-dimer", "تخثر", "بلازما"),
    ("BT-CT", "زمن النزف والتخثر", "Bleeding & clotting time", "تخثر", "دم"),
    # التهابات وروماتيزم
    ("CRP", "CRP", "C-reactive protein (CRP)", "التهابات وروماتيزم", "مصل"),
    ("HSCRP", "CRP عالي الحساسية", "High-sensitivity CRP", "التهابات وروماتيزم", "مصل"),
    ("ASO", "ASO", "Anti-streptolysin O (ASO)", "التهابات وروماتيزم", "مصل"),
    ("RF", "العامل الرثياني", "Rheumatoid factor (RF)", "التهابات وروماتيزم", "مصل"),
    ("ANTI-CCP", "Anti-CCP", "Anti-CCP antibodies", "التهابات وروماتيزم", "مصل"),
    ("ANA", "ANA", "Antinuclear antibodies (ANA)", "التهابات وروماتيزم", "مصل"),
    ("ANTI-DSDNA", "Anti-dsDNA", "Anti-dsDNA antibodies", "التهابات وروماتيزم", "مصل"),
    ("C3", "المتمم C3", "Complement C3", "التهابات وروماتيزم", "مصل"),
    ("C4", "المتمم C4", "Complement C4", "التهابات وروماتيزم", "مصل"),
    ("HLA-B27", "HLA-B27", "HLA-B27", "التهابات وروماتيزم", "دم"),
    ("PCT", "بروكالسيتونين", "Procalcitonin", "التهابات وروماتيزم", "مصل"),
    ("IGE", "IgE كلي", "Total IgE", "التهابات وروماتيزم", "مصل"),
    # مصليات وأمراض معدية
    ("HBSAG", "مستضد التهاب الكبد B السطحي", "HBsAg", "مصليات وأمراض معدية", "مصل"),
    ("ANTI-HBS", "أضداد HBs", "Anti-HBs", "مصليات وأمراض معدية", "مصل"),
    ("ANTI-HBC", "أضداد HBc الكلية", "Anti-HBc total", "مصليات وأمراض معدية", "مصل"),
    ("HCV-AB", "أضداد التهاب الكبد C", "Anti-HCV", "مصليات وأمراض معدية", "مصل"),
    ("HAV-IGM", "التهاب الكبد A (IgM)", "Hepatitis A IgM", "مصليات وأمراض معدية", "مصل"),
    ("HIV", "فيروس نقص المناعة (HIV 1/2)", "HIV 1/2 Ag/Ab", "مصليات وأمراض معدية", "مصل"),
    ("VDRL", "VDRL", "VDRL / RPR", "مصليات وأمراض معدية", "مصل"),
    ("WIDAL", "تفاعل فيدال", "Widal test", "مصليات وأمراض معدية", "مصل"),
    ("BRUC", "تفاعل رايت (البروسيلا)", "Brucella agglutination (Wright)", "مصليات وأمراض معدية", "مصل"),
    ("HP-AB", "جرثومة المعدة (أضداد)", "H. pylori antibodies", "مصليات وأمراض معدية", "مصل"),
    ("TOXO", "التوكسوبلازما IgG/IgM", "Toxoplasma IgG/IgM", "مصليات وأمراض معدية", "مصل"),
    ("RUB", "الحصبة الألمانية IgG/IgM", "Rubella IgG/IgM", "مصليات وأمراض معدية", "مصل"),
    ("CMV", "الفيروس المضخم للخلايا IgG/IgM", "CMV IgG/IgM", "مصليات وأمراض معدية", "مصل"),
    ("EBV", "فيروس إبشتاين-بار", "EBV (VCA) antibodies", "مصليات وأمراض معدية", "مصل"),
    ("MALARIA", "بحث عن الملاريا", "Malaria smear/antigen", "مصليات وأمراض معدية", "دم"),
    ("LEISH", "أضداد الليشمانيا", "Leishmania antibodies", "مصليات وأمراض معدية", "مصل"),
    ("COVID-AG", "كوفيد-19 (مستضد سريع)", "SARS-CoV-2 rapid antigen", "مصليات وأمراض معدية", "مسحة"),
    ("TB-QFT", "كوانتيفيرون السل", "QuantiFERON-TB", "مصليات وأمراض معدية", "دم"),
    # واسمات قلبية
    ("TROP", "تروبونين", "Troponin", "واسمات قلبية", "مصل"),
    ("CKMB", "CK-MB", "CK-MB", "واسمات قلبية", "مصل"),
    ("CK", "CK كلي", "Creatine kinase (CK)", "واسمات قلبية", "مصل"),
    ("BNP", "NT-proBNP", "NT-proBNP", "واسمات قلبية", "مصل"),
    ("HCY", "هوموسيستئين", "Homocysteine", "واسمات قلبية", "مصل"),
    # واسمات ورمية
    ("PSA", "PSA كلي", "Total PSA", "واسمات ورمية", "مصل"),
    ("FPSA", "PSA حر", "Free PSA", "واسمات ورمية", "مصل"),
    ("CEA", "CEA", "Carcinoembryonic antigen (CEA)", "واسمات ورمية", "مصل"),
    ("AFP", "ألفا فيتو بروتين", "Alpha-fetoprotein (AFP)", "واسمات ورمية", "مصل"),
    ("CA125", "CA 125", "CA 125", "واسمات ورمية", "مصل"),
    ("CA153", "CA 15-3", "CA 15-3", "واسمات ورمية", "مصل"),
    ("CA199", "CA 19-9", "CA 19-9", "واسمات ورمية", "مصل"),
    # بول
    ("UA", "تحليل بول كامل", "Urinalysis (complete)", "بول", "بول"),
    ("UCS", "زرع بول وتحسس", "Urine culture & sensitivity", "بول", "بول"),
    ("UPREG", "اختبار حمل في البول", "Urine pregnancy test", "بول", "بول"),
    ("UMALB", "ألبومين دقيق في البول", "Urine microalbumin", "بول", "بول"),
    ("UCA-24", "كالسيوم بول 24 ساعة", "24-hour urine calcium", "بول", "بول"),
    # براز
    ("STOOL", "تحليل براز كامل", "Stool analysis", "براز", "براز"),
    ("FOBT", "دم خفي في البراز", "Fecal occult blood", "براز", "براز"),
    ("HP-AG", "جرثومة المعدة (مستضد في البراز)", "H. pylori stool antigen", "براز", "براز"),
    ("CALPRO", "كالبروتكتين البراز", "Fecal calprotectin", "براز", "براز"),
    ("SCS", "زرع براز", "Stool culture", "براز", "براز"),
    # زروع ومسحات
    ("BCS", "زرع دم", "Blood culture", "زروع ومسحات", "دم"),
    ("THROAT", "زرع مسحة بلعوم", "Throat swab culture", "زروع ومسحات", "مسحة"),
    ("SPUTUM", "زرع قشع", "Sputum culture", "زروع ومسحات", "قشع"),
    ("AFB", "بحث عن عصيات السل (AFB)", "Sputum AFB smear", "زروع ومسحات", "قشع"),
    ("WOUND", "زرع مسحة جرح", "Wound swab culture", "زروع ومسحات", "مسحة"),
    ("HVS", "مسحة مهبلية", "High vaginal swab", "زروع ومسحات", "مسحة"),
    ("SEMEN", "تحليل سائل منوي", "Semen analysis", "زروع ومسحات", "سائل منوي"),
]


def load(apps, schema_editor):
    LabTestType = apps.get_model("diagnostics", "LabTestType")
    for code, name_ar, name_en, category, specimen in LAB_TESTS:
        LabTestType.objects.update_or_create(code=code, defaults={
            "name_ar": name_ar, "name_en": name_en, "category": category, "specimen": specimen})


class Migration(migrations.Migration):
    dependencies = [("diagnostics", "0001_initial")]
    operations = [migrations.RunPython(load, migrations.RunPython.noop)]

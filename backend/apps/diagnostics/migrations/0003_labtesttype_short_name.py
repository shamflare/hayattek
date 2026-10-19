"""Short English names as written on lab requests in Syria (CBC, FBS, HbA1c…). Physicians and
laboratories see these first; patients see the Arabic name first."""

from django.db import migrations, models

SHORT_NAMES = {
    # Hematology
    "CBC": "CBC", "HB": "Hb", "PCV": "HCT", "PLT": "PLT", "WBC-DIFF": "WBC Diff",
    "RETIC": "Retic", "ESR": "ESR", "BLOOD-FILM": "Blood film", "ABO-RH": "Blood group & Rh",
    "COOMBS-D": "Direct Coombs", "COOMBS-I": "Indirect Coombs", "HB-ELEC": "Hb electrophoresis",
    "G6PD": "G6PD", "SICKLE": "Sickling test",
    # Glucose
    "FBS": "FBS", "RBS": "RBS", "PPBS": "PPBS", "HBA1C": "HbA1c", "OGTT": "OGTT",
    "INSULIN": "Insulin", "C-PEP": "C-peptide",
    # Kidney
    "UREA": "Urea", "BUN": "BUN", "CREAT": "Creatinine", "EGFR": "eGFR", "URIC": "Uric acid",
    "CRCL-24": "CrCl 24h", "PROT-24": "Urine protein 24h", "UACR": "UACR", "CYSC": "Cystatin C",
    # Liver / pancreas
    "ALT": "ALT", "AST": "AST", "ALP": "ALP", "GGT": "GGT", "TBIL": "T. Bilirubin",
    "DBIL": "D. Bilirubin", "TP": "Total protein", "ALB": "Albumin", "LDH": "LDH",
    "AMYL": "Amylase", "LIPASE": "Lipase", "NH3": "Ammonia",
    # Lipids
    "LIPID": "Lipid profile", "CHOL": "Cholesterol", "TG": "TG", "HDL": "HDL", "LDL": "LDL",
    "LPA": "Lp(a)",
    # Electrolytes & minerals
    "NA": "Na", "K": "K", "CL": "Cl", "CA": "Ca", "ICA": "Ionized Ca", "PHOS": "Phosphorus",
    "MG": "Mg", "ZN": "Zinc", "ABG": "ABG",
    # Vitamins & iron
    "FE": "Serum iron", "TIBC": "TIBC", "FERR": "Ferritin", "TSAT": "TSAT", "VITD": "Vit D",
    "B12": "Vit B12", "FOLATE": "Folate",
    # Thyroid
    "TSH": "TSH", "FT4": "FT4", "FT3": "FT3", "T4": "T4", "T3": "T3", "ANTI-TPO": "Anti-TPO",
    "ANTI-TG": "Anti-Tg",
    # Hormones
    "BHCG": "β-hCG", "FSH": "FSH", "LH": "LH", "PRL": "Prolactin", "E2": "E2",
    "PROG": "Progesterone", "TESTO": "Testosterone", "AMH": "AMH", "CORT": "Cortisol",
    "PTH": "PTH", "GH": "GH", "DHEAS": "DHEA-S",
    # Coagulation
    "PT": "PT", "INR": "INR", "APTT": "PTT", "FIB": "Fibrinogen", "DDIMER": "D-dimer",
    "BT-CT": "BT / CT",
    # Inflammation & rheumatology
    "CRP": "CRP", "HSCRP": "hs-CRP", "ASO": "ASO", "RF": "RF", "ANTI-CCP": "Anti-CCP",
    "ANA": "ANA", "ANTI-DSDNA": "Anti-dsDNA", "C3": "C3", "C4": "C4", "HLA-B27": "HLA-B27",
    "PCT": "Procalcitonin", "IGE": "Total IgE",
    # Serology & infectious
    "HBSAG": "HBsAg", "ANTI-HBS": "Anti-HBs", "ANTI-HBC": "Anti-HBc", "HCV-AB": "Anti-HCV",
    "HAV-IGM": "HAV IgM", "HIV": "HIV 1/2", "VDRL": "VDRL", "WIDAL": "Widal",
    "BRUC": "Brucella (Wright)", "HP-AB": "H. pylori Ab", "TOXO": "Toxoplasma IgG/IgM",
    "RUB": "Rubella IgG/IgM", "CMV": "CMV IgG/IgM", "EBV": "EBV VCA", "MALARIA": "Malaria",
    "LEISH": "Leishmania Ab", "COVID-AG": "COVID-19 Ag", "TB-QFT": "QuantiFERON-TB",
    # Cardiac
    "TROP": "Troponin", "CKMB": "CK-MB", "CK": "CK", "BNP": "NT-proBNP", "HCY": "Homocysteine",
    # Tumor markers
    "PSA": "Total PSA", "FPSA": "Free PSA", "CEA": "CEA", "AFP": "AFP", "CA125": "CA 125",
    "CA153": "CA 15-3", "CA199": "CA 19-9",
    # Urine
    "UA": "Urine analysis", "UCS": "Urine C/S", "UPREG": "Urine hCG", "UMALB": "Microalbumin",
    "UCA-24": "Urine Ca 24h",
    # Stool
    "STOOL": "Stool analysis", "FOBT": "Occult blood", "HP-AG": "H. pylori Ag",
    "CALPRO": "Calprotectin", "SCS": "Stool culture",
    # Cultures & swabs
    "BCS": "Blood culture", "THROAT": "Throat swab C/S", "SPUTUM": "Sputum C/S",
    "AFB": "AFB smear", "WOUND": "Wound swab C/S", "HVS": "HVS", "SEMEN": "Semen analysis",
}


def fill(apps, schema_editor):
    LabTestType = apps.get_model("diagnostics", "LabTestType")
    for code, short in SHORT_NAMES.items():
        LabTestType.objects.filter(code=code, short_name="").update(short_name=short)


class Migration(migrations.Migration):
    dependencies = [("diagnostics", "0002_lab_test_catalog")]
    operations = [
        migrations.AddField(
            model_name="labtesttype", name="short_name",
            field=models.CharField(blank=True, help_text="Name as written on lab requests, e.g. CBC, HbA1c.",
                                   max_length=40),
        ),
        migrations.RunPython(fill, migrations.RunPython.noop),
    ]

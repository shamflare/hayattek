import {
  Activity, Building2, CalendarHeart, ClipboardList, FileText, FlaskConical, HeartPulse,
  Home, IdCard, LayoutDashboard, type LucideIcon, Pill, ScanLine, Settings, Share2,
  ShieldCheck, Stethoscope, UserPlus, Users, UsersRound, Wallet, Send,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  mobile?: boolean; // shown in the bottom bar on phones
}

export type Area = "staff" | "patient" | "admin";

export function areaForPath(pathname: string): Area {
  if (pathname.startsWith("/app/me")) return "patient";
  if (pathname.startsWith("/app/admin")) return "admin";
  return "staff";
}

export function staffNav(roles: string[], isClinician: boolean): NavItem[] {
  const has = (...r: string[]) => r.some((x) => roles.includes(x));
  const items: NavItem[] = [];
  if (has("physician", "receptionist", "nurse")) {
    items.push({ href: "/app/clinic", label: "الرئيسية", icon: Home, mobile: true });
    items.push({ href: "/app/patients", label: "المرضى", icon: Users, mobile: true });
    items.push({ href: "/app/scan", label: "مسح البطاقة", icon: ScanLine, mobile: true });
  }
  if (has("receptionist")) {
    items.push({ href: "/app/patients/new", label: "مريض جديد", icon: UserPlus });
  }
  if (isClinician) {
    items.push({ href: "/app/referrals", label: "الإحالات", icon: Send, mobile: true });
    items.push({ href: "/app/medications", label: "أدويتي وقوالبي", icon: Pill });
  }
  if (has("lab_staff", "imaging_staff")) {
    items.push({ href: "/app/lab", label: "الطلبات الواردة", icon: FlaskConical, mobile: true });
    items.push({ href: "/app/lab/new", label: "نتيجة دون طلب", icon: ClipboardList });
    if (!has("physician", "receptionist")) {
      items.push({ href: "/app/patients", label: "المرضى", icon: Users, mobile: true });
      items.push({ href: "/app/scan", label: "مسح البطاقة", icon: ScanLine, mobile: true });
    }
  }
  if (has("org_admin")) {
    items.push({ href: "/app/org", label: "فريق المنشأة", icon: UsersRound, mobile: true });
    items.push({ href: "/app/org/profile", label: "بيانات المنشأة", icon: Building2 });
  }
  return items;
}

export const patientNav: NavItem[] = [
  { href: "/app/me", label: "الرئيسية", icon: Home, mobile: true },
  { href: "/app/me/card", label: "بطاقتي الصحية", icon: IdCard, mobile: true },
  { href: "/app/me/records", label: "ملفي الطبي", icon: HeartPulse, mobile: true },
  { href: "/app/me/prescriptions", label: "الوصفات", icon: ClipboardList },
  { href: "/app/me/labs", label: "التحاليل", icon: FlaskConical },
  { href: "/app/me/documents", label: "الأشعة والمستندات", icon: FileText },
  { href: "/app/me/sharing", label: "المشاركة والموافقات", icon: Share2, mobile: true },
  { href: "/app/me/family", label: "العائلة", icon: CalendarHeart },
  { href: "/app/me/settings", label: "الإعدادات", icon: Settings },
];

export const adminNav: NavItem[] = [
  { href: "/app/admin", label: "لوحة المنصة", icon: LayoutDashboard, mobile: true },
  { href: "/app/admin/organizations", label: "المنشآت", icon: Building2, mobile: true },
  { href: "/app/admin/practitioners", label: "اعتماد الأطباء", icon: Stethoscope, mobile: true },
  { href: "/app/admin/join-requests", label: "طلبات الانضمام", icon: Send },
  { href: "/app/admin/users", label: "المستخدمون", icon: Users },
  { href: "/app/admin/plans", label: "الاشتراكات", icon: Wallet },
  { href: "/app/admin/audit", label: "السجل الأمني", icon: ShieldCheck, mobile: true },
];

export const icons = { Activity };

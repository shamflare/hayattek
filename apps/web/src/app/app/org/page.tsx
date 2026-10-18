"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Info, Lock, MoreHorizontal, Pencil, PauseCircle, PlayCircle, ShieldAlert, UserPlus, Users,
} from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import * as React from "react";
import { toast } from "sonner";

import {
  MembershipStatusBadge, ResponsiveList, RoleBadges, SearchBox, VerificationBadge,
} from "@/components/admin/common";
import { AddMemberDialog } from "@/components/admin/member-dialog";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input, Select } from "@/components/ui/field";
import { Avatar, Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { m } from "@/lib/i18n";
import { useSession } from "@/lib/session";

type Member = Schemas["Membership"];
type Role = Schemas["RolesEnum"];
type MemberStatus = Schemas["Status90dEnum"];

const ROLE_OPTIONS = (Object.keys(m.roles) as Role[]).map((value) => ({ value, label: m.roles[value] }));

export default function OrgTeamPage() {
  const { me, membership, has } = useSession();
  const queryClient = useQueryClient();
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<Member | null>(null);
  const [statusChange, setStatusChange] = React.useState<{ member: Member; status: MemberStatus } | null>(null);
  const [q, setQ] = React.useState("");
  const isAdmin = has("org_admin");

  const members = useQuery({
    queryKey: ["org", "members", membership?.id],
    queryFn: () => unwrap(api.GET("/api/v1/org/members", { params: { query: { page_size: 100 } } })),
    enabled: isAdmin,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Schemas["PatchedMembershipUpdateRequest"] }) =>
      unwrap(api.PATCH("/api/v1/org/members/{id}", { params: { path: { id } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org", "members"] }),
  });

  if (!membership) return <SkeletonList rows={5} />;
  if (!isAdmin) {
    return (
      <>
        <PageHeader title="فريق المنشأة" />
        <Card><EmptyState icon={<Lock className="size-6" />} title="هذه الصفحة لمدير المنشأة"
          description="اختر عضوية بصلاحية مدير المنشأة من قائمة المنشآت للوصول إليها." /></Card>
      </>
    );
  }

  const list = members.data?.results ?? [];
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? list.filter((mb) => [mb.user.full_name, mb.user.email, mb.user.phone, mb.title, mb.practitioner?.display_name]
        .some((v) => v?.toLowerCase().includes(needle)))
    : list;
  const pendingDoctors = list.filter((mb) => mb.practitioner && mb.practitioner.verification_status === "pending" && mb.status === "active");
  const isSelf = (mb: Member) => mb.user.id === me?.id;

  const doStatus = async () => {
    if (!statusChange) return;
    try {
      await update.mutateAsync({ id: statusChange.member.id, body: { status: statusChange.status } });
      toast.success(statusChange.status === "active" ? "أُعيد تفعيل العضو" : statusChange.status === "suspended" ? "أُوقف العضو" : "أُنهيت العضوية");
      setStatusChange(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const actions = (mb: Member) => (
    <DropdownMenu.Root dir="rtl">
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="إجراءات"><MoreHorizontal className="size-4" /></Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 w-48 rounded-2xl border border-line bg-elevated p-1.5 shadow-float">
          <MenuItem onSelect={() => setEditing(mb)}><Pencil className="size-4" /> تعديل الأدوار والمسمى</MenuItem>
          {!isSelf(mb) && (mb.status === "active" ? (
            <MenuItem danger onSelect={() => setStatusChange({ member: mb, status: "suspended" })}>
              <PauseCircle className="size-4" /> إيقاف العضو
            </MenuItem>
          ) : (
            <MenuItem onSelect={() => setStatusChange({ member: mb, status: "active" })}>
              <PlayCircle className="size-4" /> إعادة التفعيل
            </MenuItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  return (
    <>
      <PageHeader
        eyebrow={membership?.organization.name}
        title="فريق المنشأة"
        description="أضف الأطباء والاستقبال والفنيين وحدد أدوارهم."
        actions={
          <>
            <Button variant="outline" asChild><Link href="/app/org/profile"><Building2 className="size-4" /> بيانات المنشأة</Link></Button>
            <Button onClick={() => setAdding(true)}><UserPlus className="size-4" /> إضافة عضو</Button>
          </>
        }
      />

      <div className="mb-4 flex items-start gap-3 rounded-card border border-info/20 bg-info-soft p-4 text-sm text-info">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p className="leading-6">
          بصفتك مديراً للمنشأة تدير الفريق والبيانات الإدارية فقط، <b>ولا يمكنك الاطلاع على السجلات الطبية للمرضى</b>
          {has("physician") ? " بهذه الصلاحية (صلاحيتك كطبيب منفصلة)." : "."}
          {" "}الأطباء الجدد يظهرون «بانتظار التحقق» حتى تتحقق إدارة المنصة من تراخيصهم.
        </p>
      </div>

      {pendingDoctors.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-card border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p><span className="num">{pendingDoctors.length}</span> {pendingDoctors.length === 1 ? "طبيب" : "أطباء"} بانتظار تحقق إدارة المنصة: {pendingDoctors.map((d) => d.practitioner?.display_name).join("، ")}. لا يستطيعون فتح السجلات الطبية حتى الاعتماد.</p>
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted">
            {members.data && <><span className="num font-semibold text-fg">{list.filter((x) => x.status === "active").length}</span> عضو فعال</>}
          </div>
          <SearchBox value={q} onChange={setQ} placeholder="ابحث في الفريق…" className="sm:w-72" />
        </div>
        {members.error ? (
          <div className="p-4"><ErrorState message={errorMessage(members.error)} onRetry={() => members.refetch()} /></div>
        ) : members.isLoading ? (
          <div className="p-5"><SkeletonList rows={5} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Users className="size-6" />}
            title={needle ? "لا يوجد عضو مطابق" : "لا يوجد أعضاء بعد"}
            action={!needle && <Button onClick={() => setAdding(true)}><UserPlus className="size-4" /> إضافة عضو</Button>} />
        ) : (
          <ResponsiveList<Member>
            items={filtered}
            rowKey={(mb) => mb.id}
            rowClassName={(mb) => (mb.status !== "active" ? "opacity-70" : undefined)}
            head={["العضو", "الأدوار", "التحقق", "الحالة", "منذ", ""]}
            row={(mb) => [
              <MemberCell key="u" member={mb} self={isSelf(mb)} />,
              <RoleBadges key="r" roles={mb.roles} />,
              mb.practitioner ? <VerificationBadge key="v" status={mb.practitioner.verification_status} /> : <span key="v" className="text-subtle">—</span>,
              <MembershipStatusBadge key="s" status={mb.status} />,
              <span key="d" className="whitespace-nowrap text-muted">{formatDate(mb.created_at)}</span>,
              <div key="a" className="text-end">{actions(mb)}</div>,
            ]}
            card={(mb) => (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <MemberCell member={mb} self={isSelf(mb)} />
                  {actions(mb)}
                </div>
                <div className="flex flex-wrap items-center gap-1 ps-[52px]">
                  <MembershipStatusBadge status={mb.status} />
                  <RoleBadges roles={mb.roles} />
                  {mb.practitioner && <VerificationBadge status={mb.practitioner.verification_status} />}
                </div>
              </div>
            )}
          />
        )}
      </Card>

      <AddMemberDialog
        open={adding}
        onOpenChange={setAdding}
        facilityName={membership?.organization.name}
        submit={(body) => unwrap(api.POST("/api/v1/org/members", { body }))}
        onAdded={() => queryClient.invalidateQueries({ queryKey: ["org", "members"] })}
      />
      <EditMemberDialog member={editing} onClose={() => setEditing(null)} self={editing ? isSelf(editing) : false}
        save={async (body) => {
          await update.mutateAsync({ id: editing!.id, body });
          toast.success("حُفظت بيانات العضو");
          setEditing(null);
        }} />
      <ConfirmDialog
        open={statusChange !== null}
        onOpenChange={(open) => !open && setStatusChange(null)}
        title={statusChange?.status === "active" ? "إعادة تفعيل العضو؟" : "إيقاف العضو؟"}
        description={statusChange && (statusChange.status === "active"
          ? <>سيستعيد <b className="text-fg">{statusChange.member.user.full_name}</b> الوصول بأدواره الحالية.</>
          : <>سيفقد <b className="text-fg">{statusChange.member.user.full_name}</b> الوصول إلى هذه المنشأة فوراً. السجلات التي كتبها تبقى كما هي، ويمكن إعادة تفعيله لاحقاً.</>)}
        confirmLabel={statusChange?.status === "active" ? "إعادة التفعيل" : "إيقاف"}
        tone={statusChange?.status === "active" ? "primary" : "danger"}
        loading={update.isPending}
        onConfirm={doStatus}
      />
    </>
  );
}

function MenuItem({ children, onSelect, danger }: { children: React.ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <DropdownMenu.Item onSelect={onSelect}
      className={`flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm outline-none ${danger ? "text-danger data-[highlighted]:bg-danger-soft" : "data-[highlighted]:bg-sunken"}`}>
      {children}
    </DropdownMenu.Item>
  );
}

function MemberCell({ member, self }: { member: Member; self?: boolean }) {
  const name = member.practitioner?.display_name ?? member.user.full_name;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} />
      <div className="min-w-0">
        <div className="truncate font-medium">{name}{self && <span className="ms-1.5 text-xs font-normal text-subtle">(أنت)</span>}</div>
        <div className="truncate text-xs text-muted">
          {member.title ? `${member.title} · ` : ""}
          <span dir="ltr">{member.user.email ?? member.user.phone ?? ""}</span>
        </div>
      </div>
    </div>
  );
}

interface EditProps {
  member: Member | null;
  onClose: () => void;
  save: (body: Schemas["PatchedMembershipUpdateRequest"]) => Promise<void>;
  self: boolean;
}

function EditMemberDialog(props: EditProps) {
  return (
    <Dialog open={!!props.member} onOpenChange={(o) => !o && props.onClose()}>
      {props.member && <EditMemberForm {...props} member={props.member} />}
    </Dialog>
  );
}

function EditMemberForm({ member, onClose, save, self }: EditProps & { member: Member }) {
  const [roles, setRoles] = React.useState<Role[]>((member.roles ?? []) as Role[]);
  const [title, setTitle] = React.useState(member.title ?? "");
  const [department, setDepartment] = React.useState(member.department ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const departments = useQuery({
    queryKey: ["org", "departments"],
    queryFn: () => unwrap(api.GET("/api/v1/org/departments", { params: { query: { page_size: 100 } } })),
  });

  const addsPhysician = roles.includes("physician") && !member.practitioner;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roles.length) return setError("اختر دوراً واحداً على الأقل.");
    if (self && !roles.includes("org_admin")) return setError("لا يمكنك إزالة صلاحية مدير المنشأة عن نفسك.");
    setSaving(true);
    setError(null);
    try {
      await save({ roles, title: title.trim(), department: department || null });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
      <DialogContent
        title="تعديل العضو"
        description={member.user.full_name}
        footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit" form="edit-member" loading={saving}>حفظ</Button></>}
      >
        <form id="edit-member" onSubmit={submit} className="space-y-5">
          <Field label="الأدوار">
            <ChoiceChips multiple options={ROLE_OPTIONS} value={roles} onChange={(v) => setRoles(v as Role[])} />
          </Field>
          {addsPhysician && (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
              هذا العضو ليس لديه هوية طبيب في المنصة. لإضافته كطبيب استخدم «إضافة عضو» بالبريد نفسه واختر دور طبيب مع الاختصاص.
            </p>
          )}
          <Field label="المسمى الوظيفي" optional htmlFor="e-title">
            <Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="القسم" optional htmlFor="e-dept" hint={departments.data?.results.length === 0 ? "لا توجد أقسام. أضفها من بيانات المنشأة." : undefined}>
            <Select id="e-dept" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">بدون قسم</option>
              {departments.data?.results.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        </form>
      </DialogContent>
  );
}

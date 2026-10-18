"""Platform-admin listing endpoints used by the web admin area. Synthetic data only."""

from apps.organizations.models import OrganizationKind


def test_admin_organization_members_list_is_paginated(platform_admin, clinic, doctor, reception):
    r = platform_admin.get(f"/api/v1/admin/organizations/{clinic.pk}/members")
    assert r.status_code == 200
    assert r.data["count"] == 2
    assert {m["id"] for m in r.data["results"]} == {str(doctor.membership.pk),
                                                    str(reception.membership.pk)}


def test_admin_organization_filters(platform_admin, clinic, lab, make_org):
    make_org(kind=OrganizationKind.CLINIC, name="عيادة معلقة تجريبية", status="suspended")
    r = platform_admin.get("/api/v1/admin/organizations?kind=laboratory")
    assert [o["id"] for o in r.data["results"]] == [str(lab.pk)]
    r = platform_admin.get("/api/v1/admin/organizations?status=suspended")
    assert r.data["count"] == 1
    r = platform_admin.get("/api/v1/admin/organizations", data={"q": "الشفاء"})
    assert [o["id"] for o in r.data["results"]] == [str(clinic.pk)]


def test_admin_listing_requires_platform_admin(doctor, clinic):
    assert doctor.get(f"/api/v1/admin/organizations/{clinic.pk}/members").status_code == 403

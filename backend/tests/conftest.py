"""Shared fixtures. All names and records are synthetic."""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import Membership, Organization, OrganizationKind, Role
from apps.practitioners.models import Practitioner, VerificationStatus

PASSWORD = "Test-Passw0rd-Hayat!"


class Actor:
    """A signed-in user acting through one membership."""

    def __init__(self, user, membership=None):
        self.user = user
        self.membership = membership
        self.client = APIClient()
        self.client.force_authenticate(user)
        if membership is not None:
            self.client.credentials(HTTP_X_HAYAT_MEMBERSHIP=str(membership.pk))

    @property
    def organization(self):
        return self.membership.organization

    def get(self, url, **kw):
        return self.client.get(url, **kw)

    def post(self, url, data=None, **kw):
        kw.setdefault("format", "json")
        return self.client.post(url, data or {}, **kw)

    def patch(self, url, data=None, **kw):
        return self.client.patch(url, data or {}, format="json", **kw)


@pytest.fixture
def make_org(db):
    counter = {"n": 0}

    def _make(kind=OrganizationKind.MEDICAL_CENTER, name=None, status="active"):
        counter["n"] += 1
        return Organization.objects.create(name=name or f"منشأة تجريبية {counter['n']}",
                                           kind=kind, status=status)

    return _make


@pytest.fixture
def make_user(db):
    counter = {"n": 0}

    def _make(**extra):
        counter["n"] += 1
        extra.setdefault("email", f"user{counter['n']}@test.hayat")
        extra.setdefault("full_name", f"مستخدم تجريبي {counter['n']}")
        return User.objects.create_user(password=PASSWORD, **extra)

    return _make


@pytest.fixture
def make_actor(make_user):
    def _make(org, roles, *, verified=True, user=None, specialty="general_practice"):
        user = user or make_user()
        if Role.PHYSICIAN in roles and not hasattr(user, "practitioner"):
            Practitioner.objects.create(
                user=user, display_name=f"د. {user.full_name}", specialty=specialty,
                verification_status=VerificationStatus.VERIFIED if verified
                else VerificationStatus.PENDING)
        membership, _ = Membership.objects.get_or_create(user=user, organization=org,
                                                         defaults={"roles": roles})
        return Actor(user, membership)

    return _make


@pytest.fixture
def clinic(make_org):
    return make_org(name="مجمع الشفاء التجريبي")


@pytest.fixture
def other_clinic(make_org):
    return make_org(kind=OrganizationKind.CLINIC, name="عيادة الأمل التجريبية")


@pytest.fixture
def lab(make_org):
    return make_org(kind=OrganizationKind.LABORATORY, name="مختبر النور التجريبي")


@pytest.fixture
def doctor(make_actor, clinic):
    return make_actor(clinic, [Role.PHYSICIAN])


@pytest.fixture
def reception(make_actor, clinic):
    return make_actor(clinic, [Role.RECEPTIONIST])


@pytest.fixture
def other_doctor(make_actor, other_clinic):
    return make_actor(other_clinic, [Role.PHYSICIAN], specialty="cardiology")


@pytest.fixture
def lab_tech(make_actor, lab):
    return make_actor(lab, [Role.LAB_STAFF])


@pytest.fixture
def platform_admin(make_user):
    user = make_user(is_platform_admin=True)
    return Actor(user)


PATIENT_DATA = {
    "first_name": "سامي",
    "father_name": "خالد",
    "family_name": "التجريبي",
    "sex": "male",
    "birth_date": "1985-04-12",
    "phone": "0933000111",
}


@pytest.fixture
def make_patient():
    def _make(actor, **overrides):
        data = {**PATIENT_DATA, **overrides, "acknowledge_duplicates": True}
        response = actor.post("/api/v1/patients", data)
        assert response.status_code == 201, response.data
        return response.data

    return _make

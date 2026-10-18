from drf_spectacular.extensions import OpenApiAuthenticationExtension


class DeviceTokenScheme(OpenApiAuthenticationExtension):
    target_class = "apps.accounts.authentication.DeviceTokenAuthentication"
    name = "deviceToken"

    def get_security_definition(self, auto_schema):
        return {"type": "apiKey", "in": "header", "name": "Authorization",
                "description": "Mobile: `Token <raw token>`"}


class SessionScheme(OpenApiAuthenticationExtension):
    target_class = "apps.accounts.authentication.CsrfEnforcedSessionAuthentication"
    name = "sessionCookie"

    def get_security_definition(self, auto_schema):
        return {"type": "apiKey", "in": "cookie", "name": "hayat_session"}

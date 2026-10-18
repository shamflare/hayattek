from django.urls import path

from .views import DicomStudyViewSet, DicomUploadViewSet

study = DicomStudyViewSet.as_view
urlpatterns = [
    path("studies", DicomUploadViewSet.as_view({"post": "create"}), name="dicom-upload"),
    path("documents/<uuid:pk>", study({"get": "retrieve"}), name="dicom-study"),
    path("documents/<uuid:pk>/series", study({"get": "series"}), name="dicom-series"),
    path("documents/<uuid:pk>/series/<uuid:series_id>/instances", study({"get": "instances"}),
         name="dicom-instances"),
    path("documents/<uuid:pk>/instances/<uuid:instance_id>/rendered",
         study({"get": "rendered"}), name="dicom-rendered"),
]

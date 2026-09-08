# accounts/urls.py

from django.urls import path

from .views import (
    AdminProfileView,
    ThrottledTokenObtainPairView,
    ThrottledTokenRefreshView,
)

urlpatterns = [
    # SimpleJWT's stock views carry no throttling — these subclasses add it.
    path('login/',   ThrottledTokenObtainPairView.as_view(), name='token_obtain'),
    path('refresh/', ThrottledTokenRefreshView.as_view(),    name='token_refresh'),
    path('me/',      AdminProfileView.as_view(),             name='admin_profile'),
]

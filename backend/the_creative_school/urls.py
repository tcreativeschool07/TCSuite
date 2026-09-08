from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

@api_view(['GET'])
@permission_classes([AllowAny])
def api_root(request):
    return Response({
        'message': 'School Management API is running.',
        'endpoints': {
            'admin':    '/admin/',
            'login':    '/api/accounts/login/',
            'refresh':  '/api/accounts/refresh/',
            'me':       '/api/accounts/me/',
            'students': '/api/students/',
            'fees':     '/api/fees/',
        }
    })

urlpatterns = [
    path('',              api_root),
    path('admin/',        admin.site.urls),
    path('api/accounts/', include('accounts.urls')),
    path('api/students/', include('students.urls')),
    path('api/fees/',     include('fees.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

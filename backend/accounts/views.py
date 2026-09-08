from django.core.cache import cache
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .serializers import AdminProfileSerializer
from .throttling import LoginBurstThrottle, LoginIPThrottle, LoginSustainedThrottle


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """Login, rate-limited per account.

    This is the only unauthenticated write endpoint in the API and therefore the
    entire brute-force surface: without a throttle a script can try passwords
    against a known username as fast as the network allows.

    Three limits apply together — a short burst window and an hourly cap, both
    per username, plus a looser per-source cap that catches one address spraying
    many usernames. See throttling.py for why the username is the key.

    A correct password wipes the counters, so someone who mistypes twice and
    then gets it right is not left half-way to a lockout.
    """
    throttle_classes = [LoginBurstThrottle, LoginSustainedThrottle, LoginIPThrottle]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            for throttle in self.get_throttles():
                key = throttle.get_cache_key(request, self)
                if key:
                    cache.delete(key)
        return response


class ThrottledTokenRefreshView(TokenRefreshView):
    """Token refresh, rate-limited.

    Much looser than login: the frontend refreshes automatically whenever an
    access token expires mid-session, and a refresh token is a long random
    string that cannot realistically be guessed — so this limit is about
    stopping abuse of the endpoint, not about protecting a secret.
    """
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'refresh'


class AdminProfileView(APIView):

    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = AdminProfileSerializer(request.user)
        return Response(serializer.data)

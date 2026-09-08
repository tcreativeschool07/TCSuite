"""Login throttles.

Keyed on the **username being logged into**, not the caller's IP.

IP keying looked right and is wrong here for two reasons. In production the
request reaches Django through Vercel and then Render, so `REMOTE_ADDR` is a
proxy and the client address comes from `X-Forwarded-For` — a header the caller
controls, so an attacker rotates it and the throttle evaporates, while every
member of staff behind one school connection shares a single bucket. And in
development it means one person testing locks out the whole machine.

The username is what is actually under attack, and it cannot be spoofed away:
guessing passwords for `admin` is capped no matter where the guesses come from.
An IP-keyed limit sits alongside it to catch spraying — one source trying many
different usernames — where no single username cap would trip.

The trade-off of username keying is that someone could deliberately exhaust a
known account's allowance to lock its owner out. That is why the rates are set
for a person who mistypes rather than for a machine, and why a correct password
clears the counter (see ThrottledTokenObtainPairView).
"""
from rest_framework.throttling import SimpleRateThrottle


class UsernameRateThrottle(SimpleRateThrottle):
    """Base: bucket by the submitted username, falling back to the caller."""

    def get_cache_key(self, request, view):
        username = ''
        data = getattr(request, 'data', None)
        if isinstance(data, dict):
            username = str(data.get('username') or '').strip().lower()
        # No username in the body (a malformed post) — fall back to the caller
        # so the request is still counted against something.
        ident = username or self.get_ident(request)
        return self.cache_format % {'scope': self.scope, 'ident': ident}


class LoginBurstThrottle(UsernameRateThrottle):
    """Short window: absorbs a few mistypes, stops a rapid guessing loop."""
    scope = 'login_burst'


class LoginSustainedThrottle(UsernameRateThrottle):
    """Long window: caps how many guesses one account can receive per hour."""
    scope = 'login_sustained'


class LoginIPThrottle(SimpleRateThrottle):
    """Caps one source trying many different usernames.

    Deliberately looser than the per-username limits, because a whole school
    can share one public address.
    """
    scope = 'login_ip'

    def get_cache_key(self, request, view):
        return self.cache_format % {
            'scope': self.scope,
            'ident': self.get_ident(request),
        }

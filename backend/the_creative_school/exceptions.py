"""Central DRF exception handling.

Two jobs:

* Turn the exceptions that unvalidated query parameters raise — `ValueError`
  from `Field 'month' expected a number but got 'abc'`, and the like — into an
  honest 400 instead of an unhandled 500.
* Make sure nothing that escapes a view ever reaches the client as detail. DRF's
  default handler returns None for anything it doesn't recognise, which hands
  the request to Django: a full traceback when DEBUG is on, and a bare 500 when
  it isn't. Either way the operator learns nothing, because it is never logged
  with context. Here the traceback goes to the log with the request attached,
  and the client gets one flat sentence.
"""
import logging
import uuid

from django.core.exceptions import (
    ObjectDoesNotExist,
    SuspiciousOperation,
    ValidationError as DjangoValidationError,
)
from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger('the_creative_school.api')

# Exceptions that mean "the request was malformed", not "the server broke".
# Django raises these from deep inside the ORM when a query parameter can't be
# coerced to the field's type, long after any view-level check would have run.
BAD_REQUEST_EXCEPTIONS = (
    ValueError,
    TypeError,
    DjangoValidationError,
    SuspiciousOperation,
)


def api_exception_handler(exc, context):
    """DRF EXCEPTION_HANDLER. Never lets internals reach the client."""
    response = drf_exception_handler(exc, context)
    if response is not None:
        # DRF already produced a safe, structured response (validation errors,
        # 401, 403, 404, throttling). Leave it exactly as it is.
        return response

    request = context.get('request')
    view = context.get('view')

    if isinstance(exc, Http404) or isinstance(exc, ObjectDoesNotExist):
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if isinstance(exc, BAD_REQUEST_EXCEPTIONS):
        logger.warning(
            'Bad request to %s (%s): %s',
            getattr(request, 'path', '?'), type(exc).__name__, exc,
            exc_info=False,
        )
        # The exception text can name model fields and column types, so it is
        # deliberately not echoed back.
        return Response(
            {'detail': 'Invalid request. Check the values you sent and try again.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Anything left is a genuine server-side fault. Log it in full, hand the
    # user a reference they can quote, and say nothing else.
    reference = uuid.uuid4().hex[:12]
    logger.error(
        'Unhandled %s in %s at %s [ref %s]',
        type(exc).__name__,
        getattr(view, '__class__', type(view)).__name__ if view else 'unknown view',
        getattr(request, 'path', '?'),
        reference,
        exc_info=True,
    )
    return Response(
        {
            'detail': 'Something went wrong on our side. '
                      'The team has been notified — quote this reference if you report it.',
            'reference': reference,
        },
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )

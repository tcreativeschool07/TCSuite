import re

from rest_framework import viewsets, filters, status
from rest_framework.exceptions import ValidationError
from rest_framework.throttling import UserRateThrottle
from rest_framework.decorators import action
from rest_framework.response import Response
from django.http import HttpResponse
from django.db import transaction, connection
from django.db.models import Sum, Count, Q
from django.db.models.functions import Lower
from django.utils.dateparse import parse_date
from decimal import Decimal
from .models import (
    ClassRoom, AcademicYear, FeeStructure, FeeRecord, SavedBalanceSheet,
    ChargeCategory, MiscCharge, CustomReceipt,
    last_receipt_seq, format_receipt_no, generate_receipt_no,
)
from .serializers import (
    ClassRoomSerializer, AcademicYearSerializer,
    FeeStructureSerializer,
    FeeRecordListSerializer, FeeRecordDetailSerializer,
    FeeRecordCreateSerializer, FeeRecordEditSerializer,
    FeePaymentSerializer,
    FeeInvoiceSerializer, BulkGenerateSerializer,
    AdvancePaymentSerializer,
    SavedBalanceSheetSerializer, SavedBalanceSheetListSerializer,
    ChargeCategorySerializer,
    MiscChargeListSerializer, MiscChargeCreateSerializer,
    CustomReceiptSerializer, CustomReceiptCreateSerializer,
)
from .pdf import generate_student_invoice_pdf, generate_bulk_invoices_pdf, generate_balance_sheet_pdf
from .xlsx import generate_class_collection_xlsx
from students.models import StudentProfile
from students.serializers import StudentFeeInfoSerializer
from .ledger import (
    opening_balance, recompute_chain, arrears_breakdown, outstanding_items,
)

# Advisory-lock key guarding receipt-number allocation during bulk generation.
RECEIPT_LOCK_KEY = 0x0FEE0001

XLSX_CONTENT_TYPE = ('application/vnd.openxmlformats-officedocument'
                     '.spreadsheetml.sheet')

# Ceiling on the unbounded defaulters list. Big enough for every outstanding
# record in a school this size, small enough that a cleared filter can't stream
# the whole ledger into the browser.
MAX_DEFAULTERS = 2000


class ReportRateThrottle(UserRateThrottle):
    """A tighter allowance for endpoints that render a document.

    Building a class of receipts or a balance sheet costs far more CPU than a
    JSON read, so a loop over one of these is the cheapest way for a signed-in
    account to exhaust a small dyno. Rate `reports` in settings.py.
    """
    scope = 'reports'


def int_param(request, name, default=None, minimum=None, maximum=None):
    """Read an integer query parameter, or fail with a clean 400.

    A query string is user input. Passing 'abc' straight into a queryset filter
    makes the ORM raise ValueError from deep inside field coercion, which
    surfaces as an unhandled 500 — and the message it carries names the model
    field and its type. Validating at the edge turns that into an ordinary
    validation error and keeps the schema out of the response.
    """
    raw = request.query_params.get(name)
    if raw in (None, ''):
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValidationError({name: 'Must be a whole number.'})
    if minimum is not None and value < minimum:
        raise ValidationError({name: f'Must be {minimum} or greater.'})
    if maximum is not None and value > maximum:
        raise ValidationError({name: f'Must be {maximum} or less.'})
    return value


def choice_param(request, name, allowed, default=None):
    """Read a query parameter constrained to a known set of values."""
    raw = (request.query_params.get(name) or '').strip()
    if not raw:
        return default
    if raw not in allowed:
        raise ValidationError({name: f"Must be one of: {', '.join(sorted(allowed))}."})
    return raw


def safe_filename(*parts):
    """Build a Content-Disposition filename that cannot break the header.

    Student names end up in these filenames. A double quote would close the
    quoted-string early and a newline would split the header outright, so the
    value is reduced to a conservative ASCII set rather than trusted.
    """
    cleaned = []
    for part in parts:
        piece = re.sub(r'[^A-Za-z0-9._-]+', '_', str(part or '')).strip('_')
        if piece:
            cleaned.append(piece[:60])
    return '_'.join(cleaned)[:120] or 'download'


def attachment(content, filename, content_type):
    """An HTTP response that downloads `content` under a sanitised filename."""
    response = HttpResponse(content, content_type=content_type)
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def custom_receipt_payload(receipt):
    """Shape a CustomReceipt like an invoice record so it prints through the
    same receipt renderer. `custom_items` is what tells the renderer to print
    the picked lines instead of deriving them from a period's billing."""
    return {
        'receipt_no':   receipt.receipt_no,
        'student':      StudentFeeInfoSerializer(receipt.student).data,
        'month':        None,
        'year':         '',
        'custom_items': receipt.items or [],
        'total_amount': receipt.total_amount,
        'amount_paid':  0,
        'balance':      receipt.total_amount,
        'status':       'unpaid',
        'receipt_date': receipt.issued_on,
        'due_date':     receipt.due_date,
        'payment_date': None,
        'remarks':      receipt.remarks,
    }


def invoice_payloads(records):
    """Serialize fee records for an invoice/receipt, each with its arrears split.

    A receipt names the month every arrear came from, which means one ledger
    breakdown per record. Done naively that is a query per student per record;
    here every student's ledger is read once and the breakdowns are derived from
    that in memory.
    """
    records = list(records)
    payloads = FeeInvoiceSerializer(records, many=True).data
    if not records:
        return payloads

    by_student = {}
    for r in (FeeRecord.objects
              .filter(student_id__in={r.student_id for r in records})
              .order_by('year', 'month', 'id')):
        by_student.setdefault(r.student_id, []).append(r)

    for record, payload in zip(records, payloads):
        payload['arrears'] = arrears_breakdown(
            record, records=by_student.get(record.student_id, []))
    return payloads


class ClassRoomViewSet(viewsets.ModelViewSet):
    queryset         = ClassRoom.objects.all()
    serializer_class = ClassRoomSerializer

    def get_serializer_context(self):
        # The serializer's student_count would otherwise COUNT per classroom
        # (an N+1 that costs ~4 s remotely). Hand it one grouped tally instead.
        ctx = super().get_serializer_context()
        if self.action == 'list':
            ctx['student_counts'] = {
                row['cls']: row['n']
                for row in StudentProfile.objects.exclude(withdrawn='yes')
                .annotate(cls=Lower('current_class'))
                .values('cls')
                .annotate(n=Count('id'))
            }
        return ctx

    @action(detail=False, methods=['get'], url_path='with-fee-stats')
    def with_fee_stats(self, request):
        month = int_param(request, 'month', minimum=1, maximum=12)
        year  = int_param(request, 'year', minimum=1900, maximum=2200)

        from django.db.models import Count as DjCount, Value
        from django.db.models.functions import Lower

        classrooms = ClassRoom.objects.filter(is_active=True)

        student_counts = dict(
            StudentProfile.objects.exclude(withdrawn='yes')
            .values_list('current_class')
            .annotate(cnt=DjCount('id'))
            .values_list('current_class', 'cnt')
        )

        fee_stats_by_class = {}
        if month and year:
            raw = (
                FeeRecord.objects.filter(month=month, year=year)
                .values('student__current_class')
                .annotate(
                    records_count=DjCount('id'),
                    total_due=Sum('total_amount'),
                    total_collected=Sum('amount_paid'),
                    total_balance=Sum('balance'),
                    paid_count=DjCount('id', filter=Q(status='paid')),
                    unpaid_count=DjCount('id', filter=Q(status='unpaid')),
                    partial_count=DjCount('id', filter=Q(status='partial')),
                )
            )
            for row in raw:
                fee_stats_by_class[row['student__current_class']] = row

        result = []
        for cr in classrooms:
            sc = 0
            for k, v in student_counts.items():
                if k and k.lower() == cr.name.lower():
                    sc += v
            entry = {
                'id': cr.id, 'name': cr.name,
                'sort_order': cr.sort_order, 'student_count': sc,
            }
            if month and year:
                fs = None
                for k, v in fee_stats_by_class.items():
                    if k and k.lower() == cr.name.lower():
                        fs = v
                        break
                if fs:
                    entry['fee_stats'] = {
                        'records_count':   fs['records_count'],
                        'total_due':       float(fs['total_due'] or 0),
                        'total_collected': float(fs['total_collected'] or 0),
                        'total_balance':   float(fs['total_balance'] or 0),
                        'paid_count':      fs['paid_count'],
                        'unpaid_count':    fs['unpaid_count'],
                        'partial_count':   fs['partial_count'],
                    }
                else:
                    entry['fee_stats'] = {
                        'records_count': 0, 'total_due': 0, 'total_collected': 0,
                        'total_balance': 0, 'paid_count': 0, 'unpaid_count': 0, 'partial_count': 0,
                    }
            result.append(entry)
        return Response(result)

    @action(detail=True, methods=['get'], url_path='students-fee')
    def students_fee(self, request, pk=None):
        classroom = self.get_object()
        month = int_param(request, 'month', minimum=1, maximum=12)
        year  = int_param(request, 'year', minimum=1900, maximum=2200)

        students = StudentProfile.objects.filter(
            current_class__iexact=classroom.name
        ).exclude(withdrawn='yes').order_by('admission_no')

        records_map = {}
        if month and year:
            recs = FeeRecord.objects.filter(
                student__current_class__iexact=classroom.name,
                month=int(month), year=int(year),
            ).select_related('student')
            records_map = {r.student_id: r for r in recs}

        from .models import MiscCharge
        misc_map = {}
        if month and year:
            misc_qs = MiscCharge.objects.filter(
                student__current_class__iexact=classroom.name,
                month=int(month), year=int(year),
            ).values('student_id').annotate(total=Sum('amount'))
            misc_map = {row['student_id']: float(row['total']) for row in misc_qs}

        result = []
        for s in students:
            entry = {
                'id': s.id, 'admission_no': s.admission_no,
                'student_name': s.student_name, 'f_g_name': s.f_g_name,
                'f_g_contact': s.f_g_contact,
                'current_fee': float(s.current_fee) if s.current_fee else None,
                'arrear_dues': s.arrear_dues,
                'fee_record': None, 'misc_charges': misc_map.get(s.id, 0),
            }

            rec = records_map.get(s.id)
            if rec:
                entry['fee_record'] = {
                    'id': rec.id, 'receipt_no': rec.receipt_no,
                    'previous_balance': float(rec.previous_balance),
                    'current_fee': float(rec.current_fee),
                    'total_amount': float(rec.total_amount),
                    'amount_paid': float(rec.amount_paid),
                    'balance': float(rec.balance),
                    'status': rec.status, 'is_late': rec.is_late, 'is_advance': rec.is_advance,
                    'misc_charges': float(rec.misc_charges),
                    'due_date': str(rec.due_date) if rec.due_date else None,
                    'payment_date': str(rec.payment_date) if rec.payment_date else None,
                    'receipt_date': str(rec.receipt_date) if rec.receipt_date else None,
                }
            result.append(entry)

        total_students = len(result)
        with_records = sum(1 for r in result if r['fee_record'])
        agg_due = sum(r['fee_record']['total_amount'] for r in result if r['fee_record'])
        agg_collected = sum(r['fee_record']['amount_paid'] for r in result if r['fee_record'])
        agg_balance = sum(r['fee_record']['balance'] for r in result if r['fee_record'])

        return Response({
            'class_name': classroom.name, 'class_id': classroom.id,
            'month': month, 'year': year,
            'total_students': total_students,
            'records_generated': with_records,
            'without_records': total_students - with_records,
            'summary': {
                'total_due': agg_due, 'total_collected': agg_collected, 'total_balance': agg_balance,
            },
            'students': result,
        })

    @action(detail=False, methods=['post'], url_path='sync-from-students')
    def sync_from_students(self, request):
        
        classes = StudentProfile.objects.values_list('current_class', flat=True).distinct()
        classes = set(c.strip() for c in classes if c and c.strip())
        created = 0
        for c in sorted(classes):
            _, is_new = ClassRoom.objects.get_or_create(name=c, defaults={'sort_order': 50})
            if is_new:
                created += 1
        return Response({'created': created, 'total': ClassRoom.objects.count()})


class AcademicYearViewSet(viewsets.ModelViewSet):
    queryset         = AcademicYear.objects.all()
    serializer_class = AcademicYearSerializer


class FeeStructureViewSet(viewsets.ModelViewSet):
    queryset         = FeeStructure.objects.all()
    serializer_class = FeeStructureSerializer


class FeeRecordViewSet(viewsets.ModelViewSet):
    queryset = FeeRecord.objects.select_related('student').all()

    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields   = [
        'receipt_no', 'student__student_name', 'student__admission_no',
    ]
    ordering_fields = ['receipt_date', 'due_date', 'year', 'month', 'status', 'balance', 'total_amount']

    def get_serializer_class(self):
        if self.action == 'list':
            return FeeRecordListSerializer
        if self.action == 'create':
            return FeeRecordCreateSerializer
        if self.action in ('update', 'partial_update', 'edit_record'):
            return FeeRecordEditSerializer
        if self.action == 'record_payment':
            return FeePaymentSerializer
        if self.action in ('invoice', 'class_invoice'):
            return FeeInvoiceSerializer
        return FeeRecordDetailSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        status_f      = choice_param(self.request, 'status',
                                     {c[0] for c in FeeRecord.STATUS_CHOICES})
        student_id    = int_param(self.request, 'student', minimum=1)
        month         = int_param(self.request, 'month', minimum=1, maximum=12)
        year          = int_param(self.request, 'year', minimum=1900, maximum=2200)
        current_class = self.request.query_params.get('current_class')

        if status_f:
            qs = qs.filter(status=status_f)
        if student_id:
            qs = qs.filter(student__id=student_id)
        if month:
            qs = qs.filter(month=month)
        if year:
            qs = qs.filter(year=year)
        if current_class:
            qs = qs.filter(student__current_class__iexact=current_class)
        return qs

    @action(detail=False, methods=['get'], url_path='lookup-receipt')
    def lookup_receipt(self, request):
        """Look up a fee record by receipt number (full or partial).
        Accepts ?receipt=20260001 or ?receipt=0001 (assumes current year)."""
        receipt = request.query_params.get('receipt', '').strip()
        if not receipt:
            return Response({'error': 'receipt parameter is required'},
                            status=status.HTTP_400_BAD_REQUEST)

        if receipt.isdigit() and len(receipt) <= 4:
            from django.utils import timezone
            receipt = f"{timezone.now().year}{receipt.zfill(4)}"

        try:
            record = FeeRecord.objects.select_related('student').get(receipt_no=receipt)
        except FeeRecord.DoesNotExist:
            return Response({'error': f'No record found for receipt #{receipt}'},
                            status=status.HTTP_404_NOT_FOUND)

        return Response(FeeRecordDetailSerializer(record).data)

    # Record payment 
    @action(detail=True, methods=['patch'], url_path='record-payment')
    def record_payment(self, request, pk=None):
        record     = self.get_object()
        serializer = FeePaymentSerializer(record, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(FeeRecordDetailSerializer(record).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'], url_path='arrears-breakdown')
    def arrears_breakdown(self, request, pk=None):
        """Where this record's arrears come from: legacy balance and each earlier
        period still owing — so a payment can be attributed to the month it settles."""
        return Response(arrears_breakdown(self.get_object()))

    # Individual invoice data 
    @action(detail=True, methods=['get'], url_path='invoice')
    def invoice(self, request, pk=None):
        return Response(invoice_payloads([self.get_object()])[0])

    # Individual invoice PDF
    @action(detail=True, methods=['get'], url_path='invoice-pdf', throttle_classes=[ReportRateThrottle])
    def invoice_pdf(self, request, pk=None):
        data = invoice_payloads([self.get_object()])[0]
        pdf  = generate_student_invoice_pdf(data)
        filename = safe_filename('Receipt', data['receipt_no'],
                                 data['student']['student_name']) + '.pdf'
        return attachment(pdf, filename, 'application/pdf')

    # Class invoice data 
    @action(detail=False, methods=['get'], url_path='class-invoice')
    def class_invoice(self, request):
        month         = request.query_params.get('month')
        year          = request.query_params.get('year')
        current_class = request.query_params.get('current_class')

        if not all([month, year, current_class]):
            return Response(
                {"detail": "month, year, and current_class are required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        qs = self.get_queryset().filter(
            month=month, year=year,
            student__current_class__iexact=current_class
        )
        summary = qs.aggregate(
            total_due=Sum('total_amount'),
            total_collected=Sum('amount_paid'),
            total_balance=Sum('balance'),
        )
        return Response({
            'class_name': current_class,
            'month': month, 'year': year,
            'records': invoice_payloads(qs),
            'summary': {
                'total_due': float(summary['total_due'] or 0),
                'total_collected': float(summary['total_collected'] or 0),
                'total_balance': float(summary['total_balance'] or 0),
            },
            'total_students': qs.count(),
        })

    # Class collection sheet — a working spreadsheet, not a PDF: staff mark
    # payments against it and re-total, which a PDF cannot do.
    @action(detail=False, methods=['get'], url_path='class-collection-xlsx', throttle_classes=[ReportRateThrottle])
    def class_collection_xlsx(self, request):
        month         = request.query_params.get('month')
        year          = request.query_params.get('year')
        current_class = request.query_params.get('current_class')

        if not all([month, year, current_class]):
            return Response(
                {"detail": "month, year, and current_class are required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        qs = self.get_queryset().filter(
            month=month, year=year,
            student__current_class__iexact=current_class
        ).order_by('student__admission_no')

        records = FeeInvoiceSerializer(qs, many=True).data
        summary = qs.aggregate(
            total_due=Sum('total_amount'),
            total_collected=Sum('amount_paid'),
            total_balance=Sum('balance'),
        )
        summary_dict = {
            'total_due': float(summary['total_due'] or 0),
            'total_collected': float(summary['total_collected'] or 0),
            'total_balance': float(summary['total_balance'] or 0),
        }

        book = generate_class_collection_xlsx(
            current_class, month, year, records, summary_dict)
        filename = safe_filename('Fee_Collection', current_class, month, year) + '.xlsx'
        return attachment(book, filename, XLSX_CONTENT_TYPE)

    # Bulk generate fee records for a class 
    @action(detail=False, methods=['post'], url_path='bulk-generate')
    def bulk_generate(self, request):
        """
        POST /api/fees/records/bulk-generate/
        Body: { current_class, month, year, due_date? }
           or { all_classes: true, month, year, due_date? }
        Creates fee records for all active students in that class — or, with
        all_classes, across every class — who don't already have one.

        Batched on purpose: the naive per-student version issued a receipt-number
        lookup, a misc-charge aggregate and an INSERT for every student, which is
        ~1,750 round trips for a whole school. Everything below reads its lookups
        once and writes with a single bulk_create.
        """
        ser = BulkGenerateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        current_class = d.get('current_class')
        month, year   = d['month'], d['year']

        students = StudentProfile.objects.exclude(withdrawn='yes')
        if current_class:
            students = students.filter(current_class__iexact=current_class)
        students = list(students.order_by('admission_no'))
        student_ids = [s.id for s in students]

        fee_by_class = {
            fs.class_name.strip().lower(): fs.monthly_fee
            for fs in FeeStructure.objects.filter(is_active=True)
        }

        misc_by_student = dict(
            MiscCharge.objects
            .filter(student_id__in=student_ids, month=month, year=year)
            .values_list('student_id')
            .annotate(t=Sum('amount'))
            .values_list('student_id', 't')
        )

        # Existing records per student, so each new record opens with what the
        # student still owes (legacy arrears + unpaid earlier periods) rather
        # than re-seeding the profile's arrear_dues every month.
        records_by_student = {}
        for r in FeeRecord.objects.filter(student_id__in=student_ids).order_by('year', 'month', 'id'):
            records_by_student.setdefault(r.student_id, []).append(r)

        to_create = []
        skipped   = 0
        errors    = []
        per_class = {}

        # Receipt numbers are allocated from a single running sequence, and the
        # (student, month, year) pair is unique — so two runs launched together
        # (the UI lets a user queue several classes) would otherwise race into an
        # IntegrityError. Serialize the read-then-write on an advisory lock held
        # for the transaction; concurrent runs queue instead of colliding.
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(%s)", [RECEIPT_LOCK_KEY])

            existing = set(
                FeeRecord.objects
                .filter(student_id__in=student_ids, month=month, year=year)
                .values_list('student_id', flat=True)
            )
            seq = last_receipt_seq(year)

            for student in students:
                cls = (student.current_class or '').strip()
                bucket = per_class.setdefault(cls, {'created': 0, 'skipped': 0, 'failed': 0})

                if student.id in existing:
                    skipped += 1
                    bucket['skipped'] += 1
                    continue

                fee = student.current_fee or fee_by_class.get(cls.lower())
                if not fee:
                    errors.append(f"No fee for {student.student_name} (#{student.admission_no}) in {cls or 'no class'}")
                    bucket['failed'] += 1
                    continue

                arrear = opening_balance(
                    student, month, year, records=records_by_student.get(student.id, []))

                misc  = misc_by_student.get(student.id) or Decimal(0)
                total = arrear + fee + misc

                seq += 1
                to_create.append(FeeRecord(
                    receipt_no=format_receipt_no(year, seq),
                    student=student,
                    month=month,
                    year=year,
                    previous_balance=arrear,
                    current_fee=fee,
                    misc_charges=misc,
                    amount_paid=0,
                    # bulk_create bypasses FeeRecord.save(), so mirror what it would
                    # have computed for a brand-new, unpaid record.
                    total_amount=total,
                    balance=total,
                    status='unpaid',
                    due_date=d.get('due_date'),
                ))
                bucket['created'] += 1

            if to_create:
                FeeRecord.objects.bulk_create(to_create, batch_size=200)

        return Response({
            'created':  len(to_create),
            'skipped':  skipped,
            'errors':   errors,
            'total_students': len(students),
            'scope': 'all-classes' if not current_class else current_class,
            'by_class': [
                {'class_name': k, **v}
                for k, v in sorted(per_class.items())
            ] if not current_class else [],
        })

    # Bulk invoices PDF 
    @action(detail=False, methods=['get'], url_path='bulk-invoices-pdf', throttle_classes=[ReportRateThrottle])
    def bulk_invoices_pdf(self, request):
        """
        GET /api/fees/records/bulk-invoices-pdf/?current_class=X&month=6&year=2026
                                                &due_date=2026-06-10
        One PDF of receipts for a class — four students to an A4 page, a single
        copy each. A student whose arrears span too many months to itemise in a
        quarter page gets a half-page receipt instead.

        `due_date` prints that deadline on every receipt in the run, overriding
        whatever the records carry. The deadline is a school-wide decision taken
        when the receipts are printed, and this also lets a batch generated
        before anyone set one still go out with a date on it. It only affects
        what is printed — a GET does not write to the ledger.
        """
        month         = request.query_params.get('month')
        year          = request.query_params.get('year')
        current_class = request.query_params.get('current_class')

        if not all([month, year, current_class]):
            return Response(
                {"detail": "month, year, and current_class are required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        due_date = request.query_params.get('due_date')
        if due_date and not parse_date(due_date):
            return Response({"detail": "due_date must be YYYY-MM-DD."},
                            status=status.HTTP_400_BAD_REQUEST)

        qs = self.get_queryset().filter(
            month=month, year=year,
            student__current_class__iexact=current_class
        ).order_by('student__admission_no')

        records = invoice_payloads(qs)

        if not records:
            return Response(
                {"detail": "No fee records found for this class/period."},
                status=status.HTTP_404_NOT_FOUND
            )

        if due_date:
            for record in records:
                record['due_date'] = due_date

        pdf = generate_bulk_invoices_pdf(records)
        filename = safe_filename('Receipts', current_class, month, year) + '.pdf'
        return attachment(pdf, filename, 'application/pdf')

    # Edit any record 
    @action(detail=True, methods=['patch'], url_path='edit-record')
    def edit_record(self, request, pk=None):
        record     = self.get_object()
        serializer = FeeRecordEditSerializer(record, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            recompute_chain(record.student)
            record.refresh_from_db()
            return Response(FeeRecordDetailSerializer(record).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # Top Defaulters
    @action(detail=False, methods=['get'], url_path='top-defaulters')
    def top_defaulters(self, request):
        """Records still owing, largest balance first.

        `limit` caps the list — 10 by default, which is the dashboard's ranking;
        pass limit=0 for the whole list behind "View all". Narrowing by class,
        period or student comes from the viewset's own query-param filters, and
        `search` from its SearchFilter (student name / admission no / receipt),
        so this action doesn't re-implement any of it.
        """
        qs = self.filter_queryset(self.get_queryset()).filter(
            status__in=['unpaid', 'partial']
        # student_name breaks ties so equal balances keep a stable order across
        # pages instead of shuffling between requests.
        ).order_by('-balance', 'student__student_name')

        limit = int_param(request, 'limit', default=10, minimum=0,
                          maximum=MAX_DEFAULTERS)
        qs = qs[:limit if limit > 0 else MAX_DEFAULTERS]
        return Response(FeeRecordListSerializer(qs, many=True).data)

    # Advance Payment
    @action(detail=False, methods=['post'], url_path='advance-payment')
    def advance_payment(self, request):
        ser = AdvancePaymentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        students = StudentProfile.objects.filter(id__in=d['student_ids']).exclude(withdrawn='yes')
        if not students.exists():
            return Response({"detail": "No valid students found."}, status=status.HTTP_400_BAD_REQUEST)

        created = 0
        skipped = 0
        errors  = []

        for student in students:
            fee = None
            if d.get('amount_paid'):
                fee = d['amount_paid']
            elif student.current_fee:
                fee = student.current_fee
            else:
                try:
                    fs = FeeStructure.objects.get(
                        class_name__iexact=student.current_class, is_active=True
                    )
                    fee = fs.monthly_fee
                except FeeStructure.DoesNotExist:
                    errors.append(f"No fee for {student.student_name} (#{student.admission_no})")
                    continue

            for month in d['months']:
                if FeeRecord.objects.filter(student=student, month=month, year=d['year']).exists():
                    skipped += 1
                    continue

                rec = FeeRecord(
                    student=student,
                    month=month,
                    year=d['year'],
                    previous_balance=0,
                    current_fee=fee,
                    amount_paid=fee,
                    is_advance=True,
                    due_date=d.get('due_date'),
                    remarks=d.get('remarks', '') or f"Advance payment",
                )
                rec._force_status = 'advance'
                rec.save()
                created += 1

        record_ids = list(
            FeeRecord.objects.filter(
                student__in=students,
                month__in=d['months'],
                year=d['year'],
                is_advance=True,
            ).values_list('id', flat=True)
        )

        return Response({
            'created': created,
            'skipped': skipped,
            'errors': errors,
            'record_ids': record_ids,
        })

    # Distinct Years 
    @action(detail=False, methods=['get'], url_path='distinct-years')
    def distinct_years(self, request):
        from django.utils import timezone
        years_with_data = list(
            FeeRecord.objects.values_list('year', flat=True)
            .distinct().order_by('-year')
        )
        current_year = timezone.now().year
        all_years = sorted(set(years_with_data + [current_year, current_year + 1]), reverse=True)
        return Response({
            'years': all_years,
            'years_with_data': sorted(years_with_data, reverse=True),
            'current_year': current_year,
        })

    # Student Fee History
    @action(detail=False, methods=['get'], url_path='student-fee-history')
    def student_fee_history(self, request):
        student_id = request.query_params.get('student')
        if not student_id or not str(student_id).isdigit():
            return Response({"detail": "student parameter is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            student = StudentProfile.objects.get(pk=student_id)
        except StudentProfile.DoesNotExist:
            return Response({"detail": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        records = FeeRecord.objects.filter(student=student).order_by('year', 'month')

        years_data = {}
        for rec in records:
            yr = rec.year
            if yr not in years_data:
                years_data[yr] = {
                    'year': yr,
                    'months': {},
                    'total_fee': 0,
                    'total_paid': 0,
                    'total_balance': 0,
                    'records_count': 0,
                }
            years_data[yr]['months'][rec.month] = {
                'id': rec.id, 'receipt_no': rec.receipt_no,
                'month': rec.month, 'month_name': rec.get_month_display(),
                'previous_balance': float(rec.previous_balance),
                'current_fee': float(rec.current_fee),
                'misc_charges': float(rec.misc_charges),
                'total_amount': float(rec.total_amount),
                'amount_paid': float(rec.amount_paid),
                'balance': float(rec.balance),
                'status': rec.status, 'is_advance': rec.is_advance,
                'is_late': rec.is_late,
                'late_paid_on': str(rec.late_paid_on) if rec.late_paid_on else None,
                'due_date': str(rec.due_date) if rec.due_date else None,
                'payment_date': str(rec.payment_date) if rec.payment_date else None,
                'receipt_date': str(rec.receipt_date) if rec.receipt_date else None,
            }
            years_data[yr]['total_fee'] += float(rec.current_fee)
            years_data[yr]['total_paid'] += float(rec.amount_paid)
            years_data[yr]['total_balance'] += float(rec.balance)
            years_data[yr]['records_count'] += 1

        month_names = dict(FeeRecord.MONTH_CHOICES)
        result_years = []
        for yr in sorted(years_data.keys(), reverse=True):
            yd = years_data[yr]
            months_list = []
            for m in range(1, 13):
                if m in yd['months']:
                    months_list.append(yd['months'][m])
                else:
                    months_list.append({
                        'month': m,
                        'month_name': month_names.get(m, ''),
                        'status': 'no_record',
                    })
            yd['months'] = months_list
            result_years.append(yd)

        lifetime_agg = records.aggregate(
            total_fee=Sum('current_fee'),
            total_paid=Sum('amount_paid'),
            total_balance=Sum('balance'),
        )

        return Response({
            'student': {
                'id': student.id,
                'admission_no': student.admission_no,
                'student_name': student.student_name,
                'current_class': student.current_class,
                'current_fee': float(student.current_fee) if student.current_fee else None,
            },
            'lifetime': {
                'total_records': records.count(),
                'total_fee': float(lifetime_agg['total_fee'] or 0),
                'total_paid': float(lifetime_agg['total_paid'] or 0),
                'total_balance': float(lifetime_agg['total_balance'] or 0),
            },
            'years': result_years,
        })

    # Summary 
    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        qs = self.get_queryset()
        # One round trip instead of seven: every figure below is an aggregate over
        # the same rows, and the status counts are conditional counts.
        agg = qs.aggregate(
            total_records=Count('id'),
            total_due=Sum('total_amount'),
            total_collected=Sum('amount_paid'),
            total_balance=Sum('balance'),
            # total_amount = previous_balance + current_fee + misc_charges, so
            # splitting it out lets callers show the period's own charges
            # separately from arrears carried forward.
            total_current_fee=Sum('current_fee'),
            total_misc_charges=Sum('misc_charges'),
            total_previous_balance=Sum('previous_balance'),
            unpaid_count=Count('id', filter=Q(status='unpaid')),
            partial_count=Count('id', filter=Q(status='partial')),
            paid_count=Count('id', filter=Q(status='paid')),
        )
        num = lambda k: float(agg[k] or 0)
        return Response({
            'total_records':          agg['total_records'],
            'total_due':              num('total_due'),
            'total_collected':        num('total_collected'),
            'total_balance':          num('total_balance'),
            'total_current_fee':      num('total_current_fee'),
            'total_misc_charges':     num('total_misc_charges'),
            'total_previous_balance': num('total_previous_balance'),
            # This period's own billing — total_due with arrears taken out.
            'total_due_excl_arrears': num('total_due') - num('total_previous_balance'),
            'unpaid_count':           agg['unpaid_count'],
            'partial_count':          agg['partial_count'],
            'paid_count':             agg['paid_count'],
        })

    # Balance Sheet PDF 
    @action(detail=False, methods=['get'], url_path='balance-sheet-pdf', throttle_classes=[ReportRateThrottle])
    def balance_sheet_pdf(self, request):
        
        bs_response = self.balance_sheet(request)
        pdf = generate_balance_sheet_pdf(bs_response.data)
        year = request.query_params.get('year', 'all')
        filename = safe_filename('Balance_Sheet', year) + '.pdf'
        return attachment(pdf, filename, 'application/pdf')

    # Balance Sheet 
    @action(detail=False, methods=['get'], url_path='balance-sheet')
    def balance_sheet(self, request):
        from django.utils import timezone
        year = request.query_params.get('year', str(timezone.now().year))
        try:
            year = int(year)
        except (ValueError, TypeError):
            year = 2026

        # Grouped aggregates throughout: the previous per-month and per-class
        # loops issued ~120 queries (exists + aggregate + three counts, each),
        # which is ~20 s against a remote database. Same output shape.
        all_records = FeeRecord.objects.filter(year=year)
        month_names = dict(FeeRecord.MONTH_CHOICES)

        monthly = []
        monthly_rows = (
            all_records.values('month')
            .annotate(
                records=Count('id'),
                total_due=Sum('total_amount'),
                total_collected=Sum('amount_paid'),
                total_balance=Sum('balance'),
                prev_balance=Sum('previous_balance'),
                total_fee=Sum('current_fee'),
                paid=Count('id', filter=Q(status='paid')),
                unpaid=Count('id', filter=Q(status='unpaid')),
                partial=Count('id', filter=Q(status='partial')),
            )
            .order_by('month')
        )
        for row in monthly_rows:
            monthly.append({
                'month': row['month'],
                'month_name': month_names.get(row['month'], ''),
                'records': row['records'],
                'total_fee': float(row['total_fee'] or 0),
                'prev_balance': float(row['prev_balance'] or 0),
                'total_due': float(row['total_due'] or 0),
                'total_collected': float(row['total_collected'] or 0),
                'total_balance': float(row['total_balance'] or 0),
                'paid': row['paid'],
                'unpaid': row['unpaid'],
                'partial': row['partial'],
            })

        # Class matching is case-insensitive (free-text student.current_class vs
        # ClassRoom.name), so group both sides on the lower-cased name.
        by_class = {
            row['cls']: row
            for row in all_records.annotate(cls=Lower('student__current_class'))
            .values('cls')
            .annotate(
                records=Count('id'),
                total_due=Sum('total_amount'),
                total_collected=Sum('amount_paid'),
                total_balance=Sum('balance'),
            )
        }
        student_counts = {
            row['cls']: row['n']
            for row in StudentProfile.objects.exclude(withdrawn='yes')
            .annotate(cls=Lower('current_class'))
            .values('cls')
            .annotate(n=Count('id'))
        }

        classrooms = ClassRoom.objects.filter(is_active=True).order_by('sort_order', 'name')
        class_wise = []
        for cr in classrooms:
            agg = by_class.get((cr.name or '').lower())
            if not agg:
                continue
            due = float(agg['total_due'] or 0)
            collected = float(agg['total_collected'] or 0)
            class_wise.append({
                'class_name': cr.name,
                'student_count': student_counts.get((cr.name or '').lower(), 0),
                'records': agg['records'],
                'total_due': due,
                'total_collected': collected,
                'total_balance': float(agg['total_balance'] or 0),
                'collection_rate': round(collected / (due or 1) * 100, 1) if due else 0,
            })

        yearly_agg = all_records.aggregate(
            total_records=Count('id'),
            total_due=Sum('total_amount'),
            total_collected=Sum('amount_paid'),
            total_balance=Sum('balance'),
            prev_balance=Sum('previous_balance'),
            total_fee=Sum('current_fee'),
            paid=Count('id', filter=Q(status='paid')),
            unpaid=Count('id', filter=Q(status='unpaid')),
            partial=Count('id', filter=Q(status='partial')),
        )
        total_students = StudentProfile.objects.exclude(withdrawn='yes').count()
        y_due = float(yearly_agg['total_due'] or 0)
        y_collected = float(yearly_agg['total_collected'] or 0)

        result = {
            'year': year,
            'yearly_summary': {
                'total_students': total_students,
                'total_records': yearly_agg['total_records'],
                'total_fee': float(yearly_agg['total_fee'] or 0),
                'total_prev_balance': float(yearly_agg['prev_balance'] or 0),
                'total_due': y_due,
                'total_collected': y_collected,
                'total_balance': float(yearly_agg['total_balance'] or 0),
                'collection_rate': round(y_collected / (y_due or 1) * 100, 1) if y_due else 0,
                'paid': yearly_agg['paid'],
                'unpaid': yearly_agg['unpaid'],
                'partial': yearly_agg['partial'],
            },
            'monthly': monthly,
            'class_wise': class_wise,
        }

        SavedBalanceSheet.objects.update_or_create(
            year=year, defaults={'data': result}
        )

        return Response(result)


class SavedBalanceSheetViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = SavedBalanceSheet.objects.all()

    def get_serializer_class(self):
        if self.action == 'list':
            return SavedBalanceSheetListSerializer
        return SavedBalanceSheetSerializer

    @action(detail=True, methods=['get'], url_path='download-pdf', throttle_classes=[ReportRateThrottle])
    def download_pdf(self, request, pk=None):
        obj = self.get_object()
        pdf = generate_balance_sheet_pdf(obj.data)
        filename = safe_filename('Balance_Sheet', obj.year) + '.pdf'
        return attachment(pdf, filename, 'application/pdf')


class CustomReceiptViewSet(viewsets.ModelViewSet):
    """Hand-built receipts: the office picks a student, picks which of their
    outstanding dues to bill, sets a due date, and gets a numbered receipt.

    See CustomReceipt in models.py for why these are not ledger rows.
    """
    queryset = CustomReceipt.objects.select_related('student').all()
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields   = ['receipt_no', 'student__student_name', 'student__admission_no']
    ordering_fields = ['created_at', 'total_amount', 'due_date']

    def get_serializer_class(self):
        if self.action == 'create':
            return CustomReceiptCreateSerializer
        return CustomReceiptSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        student_id = self.request.query_params.get('student')
        if student_id and str(student_id).isdigit():
            qs = qs.filter(student_id=student_id)
        return qs

    def perform_create(self, serializer):
        # Receipt numbers come from one run shared with FeeRecord, allocated by
        # reading the highest issued — so two people generating at the same
        # moment would otherwise read the same number and one insert would fail
        # the unique constraint. Same advisory lock as bulk generation.
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(%s)", [RECEIPT_LOCK_KEY])
            serializer.save()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        # Answer with the full record: the caller needs the number that was
        # actually issued (the dialog only previewed one) and the id to fetch
        # the PDF with.
        return Response(CustomReceiptSerializer(serializer.instance).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='next-number')
    def next_number(self, request):
        """The number the next receipt would get.

        A preview for the dialog, not a reservation: the real number is
        allocated under the lock when the receipt is saved, so an abandoned
        dialog doesn't burn a number out of the sequence. In practice they
        match unless someone else issues one in between.
        """
        receipt_no = generate_receipt_no()
        return Response({
            'receipt_no': receipt_no,
            'receipt_display': f"{receipt_no[:4]}-{receipt_no[4:]}",
        })

    @action(detail=False, methods=['get'], url_path='student-dues')
    def student_dues(self, request):
        """Everything a student still owes, as lines that can be picked."""
        student_id = request.query_params.get('student')
        if not student_id or not str(student_id).isdigit():
            return Response({"detail": "student parameter is required."},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            student = StudentProfile.objects.get(pk=student_id)
        except StudentProfile.DoesNotExist:
            return Response({"detail": "Student not found."},
                            status=status.HTTP_404_NOT_FOUND)

        items = outstanding_items(student)
        return Response({
            'student': StudentFeeInfoSerializer(student).data,
            'items':   items,
            'total':   sum(i['amount'] for i in items),
        })

    @action(detail=True, methods=['get'], url_path='pdf', throttle_classes=[ReportRateThrottle])
    def pdf(self, request, pk=None):
        receipt = self.get_object()
        data = generate_student_invoice_pdf(custom_receipt_payload(receipt))
        filename = safe_filename('Receipt', receipt.receipt_no,
                                 receipt.student.student_name) + '.pdf'
        return attachment(data, filename, 'application/pdf')


class ChargeCategoryViewSet(viewsets.ModelViewSet):
    queryset         = ChargeCategory.objects.all()
    serializer_class = ChargeCategorySerializer
    filter_backends  = [filters.SearchFilter]
    search_fields    = ['name']


class MiscChargeViewSet(viewsets.ModelViewSet):
    queryset = MiscCharge.objects.select_related('student', 'category').all()
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields   = ['student__student_name', 'student__admission_no', 'category__name']
    ordering_fields = ['charge_date', 'amount', 'year', 'month']
    ordering        = ['-year', '-month', '-created_at']

    def get_serializer_class(self):
        if self.action in ('create',):
            return MiscChargeCreateSerializer
        return MiscChargeListSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        student_id = int_param(self.request, 'student', minimum=1)
        category   = int_param(self.request, 'category', minimum=1)
        month      = int_param(self.request, 'month', minimum=1, maximum=12)
        year       = int_param(self.request, 'year', minimum=1900, maximum=2200)

        if student_id:
            qs = qs.filter(student_id=student_id)
        if category:
            qs = qs.filter(category_id=category)
        if month:
            qs = qs.filter(month=month)
        if year:
            qs = qs.filter(year=year)
        return qs

    def perform_create(self, serializer):
        charge = serializer.save()
        self._update_fee_record_misc(charge.student, charge.month, charge.year)

    def perform_destroy(self, instance):
        student, month, year = instance.student, instance.month, instance.year
        instance.delete()
        self._update_fee_record_misc(student, month, year)

    def _update_fee_record_misc(self, student, month, year):
        """Recalculate the misc_charges sum on the corresponding FeeRecord."""
        total = MiscCharge.objects.filter(
            student=student, month=month, year=year
        ).aggregate(t=Sum('amount'))['t'] or 0
        FeeRecord.objects.filter(
            student=student, month=month, year=year
        ).update(misc_charges=total)
        try:
            rec = FeeRecord.objects.get(student=student, month=month, year=year)
            rec.save()
            recompute_chain(student)
        except FeeRecord.DoesNotExist:
            pass

    @action(detail=False, methods=['get'], url_path='student-summary')
    def student_summary(self, request):
        student_id = int_param(request, 'student', minimum=1)
        if not student_id:
            return Response({"detail": "student param required"}, status=status.HTTP_400_BAD_REQUEST)
        qs = MiscCharge.objects.filter(student_id=student_id)
        year = int_param(request, 'year', minimum=1900, maximum=2200)
        if year:
            qs = qs.filter(year=year)
        by_cat = qs.values('category__name').annotate(
            total=Sum('amount'), count=Count('id')
        ).order_by('category__name')
        return Response({
            'total': float(qs.aggregate(t=Sum('amount'))['t'] or 0),
            'count': qs.count(),
            'by_category': list(by_cat),
        })

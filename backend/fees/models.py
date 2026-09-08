from decimal import Decimal

from django.db import models
from students.models import StudentProfile


class ClassRoom(models.Model):
    name        = models.CharField(max_length=100, unique=True)
    sort_order  = models.IntegerField(default=0, help_text="Order for display sorting")
    is_active   = models.BooleanField(default=True)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'name']

    def __str__(self):
        return self.name


class AcademicYear(models.Model):
    label       = models.CharField(max_length=50, unique=True)  # e.g. "2025-2026"
    start_date  = models.CharField(max_length=20, blank=True)
    end_date    = models.CharField(max_length=20, blank=True)
    is_current  = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-label']

    def __str__(self):
        return self.label

    def save(self, *args, **kwargs):
        if self.is_current:
            AcademicYear.objects.filter(is_current=True).exclude(pk=self.pk).update(is_current=False)
        super().save(*args, **kwargs)


class FeeStructure(models.Model):
    class_name  = models.CharField(max_length=100, unique=True)
    monthly_fee = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True)
    is_active   = models.BooleanField(default=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['class_name']

    def __str__(self):
        return f"{self.class_name} — Rs. {self.monthly_fee}/month"


def _seq_of(receipt_no):
    try:
        return int(receipt_no[4:])
    except (TypeError, ValueError):
        return 0


def last_receipt_seq(year):
    """Highest receipt sequence already issued for `year` (0 if none).

    Split out of generate_receipt_no() so a bulk run can read the sequence once
    and then number a whole batch in memory instead of querying per record.

    Both tables that issue receipt numbers are consulted: a hand-built
    CustomReceipt draws from the same run of numbers as a FeeRecord, so a
    receipt number identifies one document across the whole system.
    """
    year_prefix = str(year)
    seqs = [0]
    for model in (FeeRecord, CustomReceipt):
        last = (
            model.objects
            .filter(receipt_no__startswith=year_prefix)
            .order_by('-receipt_no')
            .values_list('receipt_no', flat=True)
            .first()
        )
        if last:
            seqs.append(_seq_of(last))
    return max(seqs)


def format_receipt_no(year, seq):
    """YYYYNNNN, e.g. 20260001."""
    return f"{year}{str(seq).zfill(4)}"


def generate_receipt_no(year=None):
    """Generate receipt number in format YYYYNNNN, e.g. 20260001.
    Sequence resets to 0001 each year."""
    from django.utils import timezone
    if year is None:
        year = timezone.now().year
    return format_receipt_no(year, last_receipt_seq(year) + 1)


class FeeRecord(models.Model):
    MONTH_CHOICES = [
        (1,  'January'),  (2,  'February'), (3,  'March'),
        (4,  'April'),    (5,  'May'),       (6,  'June'),
        (7,  'July'),     (8,  'August'),    (9,  'September'),
        (10, 'October'),  (11, 'November'),  (12, 'December'),
    ]

    STATUS_CHOICES = [
        ('unpaid',  'Unpaid'),
        ('partial', 'Partial'),
        ('paid',    'Paid'),
        ('waived',  'Waived'),
        ('advance', 'Paid in Advance'),
    ]

    receipt_no        = models.CharField(max_length=20, unique=True, editable=False)
    student           = models.ForeignKey(
                            StudentProfile, on_delete=models.PROTECT,
                            related_name='fee_records')
    month             = models.IntegerField(choices=MONTH_CHOICES)
    year              = models.IntegerField()

    previous_balance  = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    current_fee       = models.DecimalField(max_digits=10, decimal_places=2)
    total_amount      = models.DecimalField(max_digits=10, decimal_places=2, editable=False)

    amount_paid       = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    balance           = models.DecimalField(max_digits=10, decimal_places=2, editable=False)

    # How amount_paid is split across the three things this record bills for, so
    # a payment records *which* debt it settles (arrears recovery vs this
    # month's fee). Always kept summing to amount_paid by save().
    paid_previous_balance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    paid_current_fee      = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    paid_misc_charges     = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    # Some or all of this period's fee was paid after its month had ended —
    # e.g. June's fee settled in August through August's arrears.
    is_late      = models.BooleanField(default=False)
    late_paid_on = models.DateField(null=True, blank=True)
    status            = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unpaid')

    receipt_date      = models.DateField(auto_now_add=True)
    due_date          = models.DateField(null=True, blank=True)
    payment_date      = models.DateField(null=True, blank=True)

    misc_charges      = models.DecimalField(max_digits=10, decimal_places=2, default=0,
                            help_text="Sum of miscellaneous charges for this period.")
    is_advance        = models.BooleanField(default=False,
                            help_text="True if this record was created via advance payment.")
    # How much of this record was settled out of the student's advance credit.
    # It is counted inside amount_paid — an advance is money the school already
    # holds — and kept separately so the receipt can show what was cash and what
    # came out of the wallet, and so applying it stays auditable.
    advance_applied   = models.DecimalField(max_digits=10, decimal_places=2, default=0,
                            help_text="Part of amount_paid that came from the "
                                      "student's advance credit.")

    remarks           = models.TextField(blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        ordering        = ['-year', '-month']
        unique_together = ('student', 'month', 'year')

    def allocation_total(self):
        return ((self.paid_previous_balance or 0)
                + (self.paid_current_fee or 0)
                + (self.paid_misc_charges or 0))

    def allocate_payment(self):
        """Split amount_paid across the billed buckets, oldest debt first.

        Used when amount_paid is set on its own (edit-record, advance payments,
        legacy callers) and no explicit allocation came with it.
        """
        remaining = self.amount_paid or 0
        for attr, billed in (
            ('paid_previous_balance', self.previous_balance or 0),
            ('paid_current_fee',      self.current_fee or 0),
            ('paid_misc_charges',     self.misc_charges or 0),
        ):
            take = min(remaining, billed)
            setattr(self, attr, take)
            remaining -= take
        if remaining > 0:
            # Overpayment — park the excess against the current month's fee.
            self.paid_current_fee = (self.paid_current_fee or 0) + remaining

    def save(self, *args, **kwargs):
        if not self.receipt_no:
            self.receipt_no = generate_receipt_no(self.year)

        self.total_amount = (self.previous_balance or 0) + (self.current_fee or 0) + (self.misc_charges or 0)
        self.balance      = self.total_amount - (self.amount_paid or 0)

        # When a caller sets the split explicitly the two already agree and this
        # is a no-op; otherwise re-derive it so the breakdown never drifts from
        # amount_paid, whichever code path wrote it.
        if self.allocation_total() != (self.amount_paid or 0):
            self.allocate_payment()

        force_status = getattr(self, '_force_status', None)
        if force_status:
            self.status = force_status
            if force_status in ('waived', 'advance'):
                self.balance = 0
            delattr(self, '_force_status')
        else:
            if (self.amount_paid or 0) <= 0:
                self.status = 'unpaid'
            elif self.balance <= 0:
                self.status = 'paid'
                self.balance = 0
            else:
                self.status = 'partial'

        # When the money was received. This used to be set only once a record
        # was fully settled, so a partial payment left no record of the date it
        # came in at all. Any payment now stamps it; the first one wins, and the
        # payment flow overwrites it with the date of the payment being applied.
        if (self.amount_paid or 0) > 0 and not self.payment_date:
            from django.utils import timezone
            self.payment_date = timezone.now().date()
        elif self.status == 'advance' and not self.payment_date:
            from django.utils import timezone
            self.payment_date = timezone.now().date()

        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.receipt_no} — {self.student.student_name} — {self.get_month_display()} {self.year}"


class ChargeCategory(models.Model):
    """Categories for miscellaneous charges: books, notebooks, diaries, etc."""
    name        = models.CharField(max_length=150, unique=True)
    amount      = models.DecimalField(max_digits=10, decimal_places=2, default=0,
                      help_text="Default/fixed charge amount for this category")
    description = models.TextField(blank=True)
    is_active   = models.BooleanField(default=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name_plural = 'Charge Categories'

    def __str__(self):
        return f"{self.name} — Rs. {self.amount}"


class MiscCharge(models.Model):
    """A single miscellaneous charge record for a student."""
    student     = models.ForeignKey(
                      StudentProfile, on_delete=models.PROTECT,
                      related_name='misc_charges')
    category    = models.ForeignKey(
                      ChargeCategory, on_delete=models.PROTECT,
                      related_name='charges')
    amount      = models.DecimalField(max_digits=10, decimal_places=2)
    month       = models.IntegerField(choices=FeeRecord.MONTH_CHOICES)
    year        = models.IntegerField()
    charge_date = models.DateField(auto_now_add=True)
    remarks     = models.TextField(blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-year', '-month', '-created_at']

    def __str__(self):
        return f"{self.student.student_name} — {self.category.name} — Rs. {self.amount}"


class CustomReceipt(models.Model):
    """A one-off receipt assembled by hand from a student's existing dues.

    Deliberately *not* a ledger row. Everything it lists is already billed on a
    FeeRecord, so counting it again would double the school's receivables and
    corrupt the balance sheet. What it does own is the paperwork: a permanent,
    unique receipt number drawn from the same run as FeeRecord's (see
    last_receipt_seq), the due date the office set, and a frozen copy of the
    lines that were printed — so a receipt handed to a parent can still be
    looked up months later even after those dues have been settled.
    """
    receipt_no   = models.CharField(max_length=20, unique=True, editable=False)
    student      = models.ForeignKey(
                       StudentProfile, on_delete=models.PROTECT,
                       related_name='custom_receipts')

    # Frozen line items: [{key, label, amount, kind, record, month, year}].
    # A snapshot on purpose — reprinting must show what was issued, not what is
    # outstanding today.
    items        = models.JSONField(default=list)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    due_date     = models.DateField(null=True, blank=True)
    issued_on    = models.DateField(auto_now_add=True)
    remarks      = models.TextField(blank=True)

    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.receipt_no} — {self.student.student_name} — Rs. {self.total_amount}"

    def save(self, *args, **kwargs):
        if not self.receipt_no:
            self.receipt_no = generate_receipt_no()
        self.total_amount = sum(
            (Decimal(str(i.get('amount') or 0)) for i in (self.items or [])), Decimal(0))
        super().save(*args, **kwargs)


class SavedBalanceSheet(models.Model):
    year         = models.IntegerField(unique=True)
    data         = models.JSONField(help_text="Full balance sheet JSON snapshot")
    generated_at = models.DateTimeField(auto_now=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-year']

    def __str__(self):
        return f"Balance Sheet — {self.year}"

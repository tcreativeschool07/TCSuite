from rest_framework import serializers
from .models import (
    ClassRoom, AcademicYear, FeeStructure, FeeRecord, SavedBalanceSheet,
    ChargeCategory, MiscCharge, CustomReceipt,
)
from students.models import StudentProfile
from students.serializers import StudentFeeInfoSerializer


class ClassRoomSerializer(serializers.ModelSerializer):
    student_count = serializers.SerializerMethodField()

    class Meta:
        model  = ClassRoom
        fields = ['id', 'name', 'sort_order', 'is_active', 'student_count', 'created_at']

    def get_student_count(self, obj):
        # List views pass a pre-grouped tally (see ClassRoomViewSet); single
        # objects fall back to the direct count.
        counts = self.context.get('student_counts')
        if counts is not None:
            return counts.get((obj.name or '').lower(), 0)
        return StudentProfile.objects.filter(
            current_class__iexact=obj.name
        ).exclude(withdrawn='yes').count()


class AcademicYearSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AcademicYear
        fields = '__all__'


class FeeStructureSerializer(serializers.ModelSerializer):
    class Meta:
        model  = FeeStructure
        fields = '__all__'


class FeeRecordListSerializer(serializers.ModelSerializer):
    student_name  = serializers.CharField(source='student.student_name',  read_only=True)
    admission_no  = serializers.CharField(source='student.admission_no',  read_only=True)
    current_class = serializers.CharField(source='student.current_class', read_only=True)
    month_name    = serializers.CharField(source='get_month_display',     read_only=True)
    f_g_name      = serializers.CharField(source='student.f_g_name',     read_only=True)
    f_g_contact   = serializers.CharField(source='student.f_g_contact',  read_only=True)
    # The credit still held, so a list row can show it beside what this record used.
    student_advance = serializers.DecimalField(
        source='student.advance', max_digits=10, decimal_places=2, read_only=True)
    receipt_display = serializers.SerializerMethodField()

    class Meta:
        model  = FeeRecord
        fields = [
            'id', 'receipt_no', 'receipt_display',
            'student', 'student_name', 'admission_no', 'current_class',
            'f_g_name', 'f_g_contact',
            'month', 'month_name', 'year',
            'previous_balance', 'current_fee', 'total_amount',
            'amount_paid', 'balance', 'status', 'is_advance', 'misc_charges',
            'advance_applied', 'student_advance',
            'paid_previous_balance', 'paid_current_fee', 'paid_misc_charges',
            'is_late', 'late_paid_on',
            'due_date', 'payment_date', 'receipt_date',
        ]

    def get_receipt_display(self, obj):
        r = obj.receipt_no or ''
        if len(r) == 8 and r.isdigit():
            return f"{r[:4]}-{r[4:]}"
        return r


class FeeRecordDetailSerializer(serializers.ModelSerializer):
    student    = StudentFeeInfoSerializer(read_only=True)
    month_name = serializers.CharField(source='get_month_display', read_only=True)
    receipt_display = serializers.SerializerMethodField()

    class Meta:
        model  = FeeRecord
        fields = [
            'id', 'receipt_no', 'receipt_display',
            'student', 'month', 'month_name', 'year',
            'previous_balance', 'current_fee', 'total_amount',
            'amount_paid', 'balance', 'status', 'is_advance', 'misc_charges',
            'advance_applied',
            'paid_previous_balance', 'paid_current_fee', 'paid_misc_charges',
            'is_late', 'late_paid_on',
            'receipt_date', 'due_date', 'payment_date',
            'remarks', 'created_at', 'updated_at',
        ]

    def get_receipt_display(self, obj):
        r = obj.receipt_no or ''
        if len(r) == 8 and r.isdigit():
            return f"{r[:4]}-{r[4:]}"
        return r


class FeeRecordCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model  = FeeRecord
        fields = [
            'student', 'month', 'year',
            'previous_balance', 'current_fee', 'misc_charges',
            'amount_paid', 'due_date', 'remarks',
        ]
        # validate() below resolves the fee from the student's override or the
        # class fee structure, but DRF's field-level check ran first and
        # rejected the request before it could — so that fallback was
        # unreachable unless the caller sent an explicit 0.
        extra_kwargs = {'current_fee': {'required': False}}

    def validate(self, data):
        student = data.get('student')

        if 'previous_balance' not in data or data.get('previous_balance', 0) == 0:
            # Legacy arrears plus whatever earlier periods still owe (fees/ledger.py).
            from .ledger import opening_balance
            data['previous_balance'] = opening_balance(student, data.get('month'), data.get('year'))

        if 'current_fee' not in data or not data.get('current_fee'):
            if student.current_fee:
                data['current_fee'] = student.current_fee
            else:
                try:
                    structure = FeeStructure.objects.get(
                        class_name=student.current_class,
                        is_active=True
                    )
                    data['current_fee'] = structure.monthly_fee
                except FeeStructure.DoesNotExist:
                    raise serializers.ValidationError(
                        f"No fee structure for class '{student.current_class}' and "
                        f"student has no individual fee set."
                    )

        exists = FeeRecord.objects.filter(
            student=student,
            month=data.get('month'),
            year=data.get('year')
        ).exists()
        if exists:
            raise serializers.ValidationError(
                "A fee record already exists for this student for this month/year."
            )

        return data


    def create(self, validated_data):
        """Apply the student's advance credit, as bulk-generate does.

        Without this a record made one-off would bill a student for money the
        school is already holding, and the two creation paths would disagree.
        """
        from .ledger import take_advance
        student = validated_data['student']
        record = FeeRecord(**validated_data)
        total = ((record.previous_balance or 0) + (record.current_fee or 0)
                 + (record.misc_charges or 0))
        already_paid = record.amount_paid or 0
        used = take_advance(student, max(0, total - already_paid))
        if used > 0:
            record.advance_applied = used
            record.amount_paid = already_paid + used
            student.save(update_fields=['advance'])
        record.save()
        return record


class FeeRecordEditSerializer(serializers.ModelSerializer):
    class Meta:
        model  = FeeRecord
        fields = [
            'previous_balance', 'current_fee', 'misc_charges',
            'amount_paid', 'status',
            'due_date', 'payment_date', 'remarks',
        ]

    def validate_amount_paid(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Amount paid cannot be negative.")
        return value

    def update(self, instance, validated_data):
        force_status = validated_data.pop('status', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if force_status and force_status in ('unpaid', 'partial', 'paid', 'waived', 'advance'):
            instance._force_status = force_status
        instance.save()
        return instance


PAY_PARTS = {
    'pay_previous_balance': ('previous_balance', 'paid_previous_balance', 'arrears'),
    'pay_current_fee':      ('current_fee',      'paid_current_fee',      "this month's fee"),
    'pay_misc_charges':     ('misc_charges',     'paid_misc_charges',     'misc charges'),
}


class FeePaymentSerializer(serializers.ModelSerializer):
    """Records a payment against a fee record. Two accepted shapes:

    * pay_previous_balance / pay_current_fee / pay_misc_charges — what is being
      paid *now*, added to what the record has already collected. This is what
      the payment form sends, and it captures which debt the money settles.
    * amount_paid — sets the cumulative total directly. This is the original
      contract (still used by the legacy frontend and by edit flows); the split
      is then re-derived oldest-debt-first by FeeRecord.save().
    """
    pay_previous_balance = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, min_value=0, write_only=True)
    pay_current_fee = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, min_value=0, write_only=True)
    pay_misc_charges = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, min_value=0, write_only=True)
    # Where an arrears payment goes: omitted/'auto' = oldest dues first,
    # 'legacy' = balance from before the first record, or an earlier record's id
    # to settle that specific month (tagged late on that record).
    arrears_target = serializers.CharField(required=False, allow_blank=True, allow_null=True, write_only=True)
    # Several months in one payment: [{target:'legacy', amount}, {target:<id>, fee, misc}]
    arrears_allocations = serializers.ListField(
        child=serializers.DictField(), required=False, write_only=True)

    class Meta:
        model  = FeeRecord
        fields = ['amount_paid', 'payment_date', 'remarks',
                  'pay_previous_balance', 'pay_current_fee', 'pay_misc_charges',
                  'arrears_target', 'arrears_allocations']
        extra_kwargs = {'amount_paid': {'required': False}}

    def validate_amount_paid(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Amount paid cannot be negative.")
        return value

    def validate(self, attrs):
        parts = {k: attrs.get(k) for k in PAY_PARTS}
        allocations = attrs.get('arrears_allocations') or []
        itemised = any(v is not None for v in parts.values()) or bool(allocations)

        if not itemised:
            if attrs.get('amount_paid') is None:
                raise serializers.ValidationError(
                    "Provide amount_paid, or a breakdown of what is being paid.")
            return attrs

        if attrs.get('amount_paid') is not None:
            raise serializers.ValidationError(
                "Send either amount_paid or the pay_* breakdown, not both.")
        alloc_total = sum(
            float(a.get('amount') or 0) + float(a.get('fee') or 0) + float(a.get('misc') or 0)
            for a in allocations if isinstance(a, dict))
        if not any(parts.values()) and alloc_total <= 0:
            raise serializers.ValidationError(
                "Enter an amount against at least one month, fee or charge.")

        # Each bucket can only take what it still owes, so a payment can't be
        # booked against a debt that isn't there. Arrears are capped by the
        # ledger for the chosen target (fees/ledger.py).
        from .ledger import arrears_cap, LedgerError
        record = self.instance
        for key, (billed_f, paid_f, label) in PAY_PARTS.items():
            amount = parts.get(key)
            if not amount:
                continue
            if key == 'pay_previous_balance':
                try:
                    outstanding = arrears_cap(record, attrs.get('arrears_target'))
                except LedgerError as e:
                    raise serializers.ValidationError({'arrears_target': str(e)})
            else:
                # Clamped: an earlier overpayment must not report a negative debt.
                outstanding = max(0, (getattr(record, billed_f) or 0) - (getattr(record, paid_f) or 0))
            if amount > outstanding:
                raise serializers.ValidationError({
                    key: f"Only Rs {outstanding:.0f} outstanding against {label}."
                })
        return attrs

    def update(self, instance, validated_data):
        from .ledger import (route_arrears_payment, route_arrears_allocations,
                             recompute_chain, is_late, LedgerError)
        parts = {k: validated_data.pop(k, None) for k in PAY_PARTS}
        target = validated_data.pop('arrears_target', None)
        allocations = validated_data.pop('arrears_allocations', None) or []
        itemised = any(v is not None for v in parts.values()) or bool(allocations)
        if itemised:
            # Arrears go to the month(s) they settle — an earlier record when one
            # exists, otherwise this record's own previous-balance bucket.
            arrears = parts.get('pay_previous_balance') or 0
            try:
                if arrears:
                    route_arrears_payment(instance, arrears, target)
                if allocations:
                    route_arrears_allocations(instance, allocations)
            except LedgerError as e:
                raise serializers.ValidationError({'pay_previous_balance': str(e)})
            for key, (_, paid_f, _label) in PAY_PARTS.items():
                if key == 'pay_previous_balance':
                    continue
                setattr(instance, paid_f, (getattr(instance, paid_f) or 0) + (parts[key] or 0))
            own_paid = (parts.get('pay_current_fee') or 0) + (parts.get('pay_misc_charges') or 0)
            if own_paid > 0 and is_late(instance):
                from datetime import date
                instance.is_late = True
                instance.late_paid_on = date.today()
            # save() leaves an allocation that already sums to amount_paid alone.
            instance.amount_paid = instance.allocation_total()
            # The receipt should show when *this* payment was taken, so a later
            # instalment moves the date on rather than keeping the first one.
            # An explicit payment_date in the request still wins (handled below).
            if own_paid > 0 and 'payment_date' not in validated_data:
                from datetime import date
                instance.payment_date = date.today()
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        # Anything paid upstream changes what this and later periods carry.
        recompute_chain(instance.student)
        instance.refresh_from_db()
        return instance


class FeeInvoiceSerializer(serializers.ModelSerializer):
    student    = StudentFeeInfoSerializer(read_only=True)
    month_name = serializers.CharField(source='get_month_display', read_only=True)
    receipt_display = serializers.SerializerMethodField()

    class Meta:
        model  = FeeRecord
        fields = [
            'id', 'receipt_no', 'receipt_display',
            'student', 'month', 'month_name', 'year',
            'previous_balance', 'current_fee', 'total_amount',
            'amount_paid', 'balance', 'status', 'is_advance', 'misc_charges',
            'advance_applied',
            'receipt_date', 'due_date', 'payment_date', 'remarks',
        ]

    def get_receipt_display(self, obj):
        r = obj.receipt_no or ''
        if len(r) == 8 and r.isdigit():
            return f"{r[:4]}-{r[4:]}"
        return r


class BulkGenerateSerializer(serializers.Serializer):
    current_class = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    all_classes   = serializers.BooleanField(required=False, default=False)
    month         = serializers.IntegerField(min_value=1, max_value=12)
    year          = serializers.IntegerField(min_value=2020, max_value=2099)
    due_date      = serializers.DateField(required=False, allow_null=True)

    def validate(self, attrs):
        # all_classes must be opted into explicitly: a caller that simply forgot
        # current_class should get an error, not fee records for the whole school.
        if attrs.get('all_classes'):
            attrs['current_class'] = None
        elif not (attrs.get('current_class') or '').strip():
            raise serializers.ValidationError(
                "Provide current_class, or set all_classes=true to generate for every class."
            )
        return attrs


class AdvancePaymentSerializer(serializers.Serializer):
    """An advance payment, taken either of two ways.

    * Pick months — prepays those specific months, creating a settled record for
      each, as before.
    * Enter a credit amount with no months — the money sits on the student as
      credit and is drawn down automatically by whichever months are generated
      next. This is the case where a parent hands over a round sum that does not
      divide neatly into months.

    Both are allowed at once; months are prepaid first and any credit is added
    on top.
    """
    student_ids     = serializers.ListField(
        child=serializers.IntegerField(), min_length=1)
    # No longer required: an advance need not be tied to particular months.
    months          = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=12),
        required=False, default=list)
    year            = serializers.IntegerField(min_value=2020, max_value=2099)
    amount_paid     = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True)
    # The arbitrary sum to hold as credit.
    advance_amount  = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True,
        min_value=0)
    due_date        = serializers.DateField(required=False, allow_null=True)
    remarks         = serializers.CharField(required=False, allow_blank=True, default='')

    def validate(self, attrs):
        if not attrs.get('months') and not attrs.get('advance_amount'):
            raise serializers.ValidationError(
                "Choose at least one month to prepay, or enter a credit amount.")
        return attrs


class CustomReceiptItemSerializer(serializers.Serializer):
    """One printed line on a hand-built receipt."""
    key    = serializers.CharField(required=False, allow_blank=True)
    kind   = serializers.CharField(required=False, allow_blank=True)
    label  = serializers.CharField(max_length=200)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)
    record = serializers.IntegerField(required=False, allow_null=True)
    month  = serializers.IntegerField(required=False, allow_null=True)
    year   = serializers.IntegerField(required=False, allow_null=True)


class CustomReceiptSerializer(serializers.ModelSerializer):
    student_name    = serializers.CharField(source='student.student_name',  read_only=True)
    admission_no    = serializers.CharField(source='student.admission_no',  read_only=True)
    current_class   = serializers.CharField(source='student.current_class', read_only=True)
    receipt_display = serializers.SerializerMethodField()

    class Meta:
        model  = CustomReceipt
        fields = [
            'id', 'receipt_no', 'receipt_display',
            'student', 'student_name', 'admission_no', 'current_class',
            'items', 'total_amount', 'due_date', 'issued_on', 'remarks',
            'created_at',
        ]
        read_only_fields = ['receipt_no', 'total_amount', 'issued_on', 'created_at']

    def get_receipt_display(self, obj):
        r = obj.receipt_no or ''
        if len(r) == 8 and r.isdigit():
            return f"{r[:4]}-{r[4:]}"
        return r


class CustomReceiptCreateSerializer(serializers.ModelSerializer):
    items = serializers.ListField(child=CustomReceiptItemSerializer(), min_length=1)

    class Meta:
        model  = CustomReceipt
        fields = ['student', 'items', 'due_date', 'remarks']

    def validate_items(self, value):
        # A receipt for nothing is not a receipt — and the amounts are what the
        # office edited, so they are trusted but must be real figures.
        total = sum(float(i.get('amount') or 0) for i in value)
        if total <= 0:
            raise serializers.ValidationError(
                "Select at least one due, with an amount above zero.")
        return value

    def create(self, validated_data):
        # DecimalField instances don't survive JSONField, so the frozen copy is
        # stored as plain floats — the same shape the API returns.
        validated_data['items'] = [
            {**item, 'amount': float(item['amount'])} for item in validated_data['items']
        ]
        return super().create(validated_data)


class SavedBalanceSheetSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SavedBalanceSheet
        fields = ['id', 'year', 'data', 'generated_at', 'created_at']
        read_only_fields = ['id', 'generated_at', 'created_at']


class SavedBalanceSheetListSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SavedBalanceSheet
        fields = ['id', 'year', 'generated_at', 'created_at']


class ChargeCategorySerializer(serializers.ModelSerializer):
    charges_count = serializers.SerializerMethodField()

    class Meta:
        model  = ChargeCategory
        fields = ['id', 'name', 'amount', 'description', 'is_active', 'charges_count', 'created_at', 'updated_at']

    def get_charges_count(self, obj):
        return obj.charges.count()


class MiscChargeListSerializer(serializers.ModelSerializer):
    student_name  = serializers.CharField(source='student.student_name', read_only=True)
    admission_no  = serializers.CharField(source='student.admission_no', read_only=True)
    current_class = serializers.CharField(source='student.current_class', read_only=True)
    category_name = serializers.CharField(source='category.name', read_only=True)
    month_name    = serializers.SerializerMethodField()

    class Meta:
        model  = MiscCharge
        fields = [
            'id', 'student', 'student_name', 'admission_no', 'current_class',
            'category', 'category_name', 'amount',
            'month', 'month_name', 'year',
            'charge_date', 'remarks', 'created_at',
        ]

    def get_month_name(self, obj):
        return dict(FeeRecord.MONTH_CHOICES).get(obj.month, '')


class MiscChargeCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MiscCharge
        fields = ['student', 'category', 'amount', 'month', 'year', 'remarks']

    def validate(self, data):
        if not data.get('amount') or data['amount'] <= 0:
            cat = data.get('category')
            if cat and cat.amount > 0:
                data['amount'] = cat.amount
            else:
                raise serializers.ValidationError("Amount must be greater than zero.")
        return data

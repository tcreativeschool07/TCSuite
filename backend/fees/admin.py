from django.contrib import admin
from .models import (
    ClassRoom, AcademicYear, FeeStructure, FeeRecord, SavedBalanceSheet,
    ChargeCategory, MiscCharge, CustomReceipt,
)


@admin.register(ClassRoom)
class ClassRoomAdmin(admin.ModelAdmin):
    list_display  = ['name', 'sort_order', 'is_active']
    list_editable = ['sort_order', 'is_active']
    search_fields = ['name']


@admin.register(AcademicYear)
class AcademicYearAdmin(admin.ModelAdmin):
    list_display  = ['label', 'start_date', 'end_date', 'is_current']
    list_editable = ['is_current']


@admin.register(FeeStructure)
class FeeStructureAdmin(admin.ModelAdmin):
    list_display  = ['class_name', 'monthly_fee', 'is_active']
    list_filter   = ['is_active']
    search_fields = ['class_name']


@admin.register(FeeRecord)
class FeeRecordAdmin(admin.ModelAdmin):
    list_display  = [
        'receipt_no', 'student', 'month', 'year',
        'previous_balance', 'current_fee', 'total_amount',
        'amount_paid', 'balance', 'status', 'due_date', 'payment_date',
    ]
    list_filter   = ['status', 'month', 'year']
    search_fields = [
        'receipt_no', 'student__student_name', 'student__admission_no',
    ]
    readonly_fields = ['receipt_no', 'total_amount', 'balance', 'receipt_date']


@admin.register(SavedBalanceSheet)
class SavedBalanceSheetAdmin(admin.ModelAdmin):
    list_display = ['year', 'generated_at']


@admin.register(ChargeCategory)
class ChargeCategoryAdmin(admin.ModelAdmin):
    list_display  = ['name', 'amount', 'is_active']
    list_editable = ['amount', 'is_active']
    search_fields = ['name']


@admin.register(MiscCharge)
class MiscChargeAdmin(admin.ModelAdmin):
    list_display  = ['student', 'category', 'amount', 'month', 'year', 'charge_date']
    list_filter   = ['category', 'month', 'year']
    search_fields = ['student__student_name', 'student__admission_no', 'category__name']


@admin.register(CustomReceipt)
class CustomReceiptAdmin(admin.ModelAdmin):
    list_display  = ['receipt_no', 'student', 'total_amount', 'due_date', 'issued_on']
    list_filter   = ['issued_on']
    search_fields = ['receipt_no', 'student__student_name', 'student__admission_no']
    # The number, the total and the printed lines are the record of what was
    # handed to a parent — editing them after the fact would make the copy lie.
    readonly_fields = ['receipt_no', 'total_amount', 'items', 'issued_on']

from django.contrib import admin
from .models import StudentProfile


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display  = [
        'admission_no', 'student_name', 'current_class',
        'current_fee', 'f_g_name', 'f_g_contact', 'withdrawn', 'arrear_dues',
    ]
    list_filter   = ['withdrawn', 'current_class', 'religion']
    search_fields = [
        'student_name', 'admission_no', 'b_form', 'f_g_name', 'f_g_cnic',
    ]

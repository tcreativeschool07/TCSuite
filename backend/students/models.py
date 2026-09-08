from django.db import models


class StudentProfile(models.Model):

    WITHDRAWN_CHOICES = [
        ('yes', 'Yes'),
        ('no',  'No'),
    ]

    # Admission info
    admission_no       = models.CharField(max_length=50,  unique=True)
    date_of_admission  = models.CharField(max_length=50,  blank=True)

    # Student personal info
    student_name       = models.CharField(max_length=200)
    b_form             = models.CharField(max_length=50,  unique=True, null=True, blank=True)
    dob                = models.CharField(max_length=50,  blank=True)
    religion           = models.CharField(max_length=100, blank=True)
    tribe_caste        = models.CharField(max_length=100, blank=True)
    address            = models.CharField(max_length=500, blank=True)

    # Father/Guardian info
    f_g_name           = models.CharField(max_length=200, blank=True)
    f_g_cnic           = models.CharField(max_length=50,  blank=True)
    f_g_occupation     = models.CharField(max_length=200, blank=True)
    f_g_contact        = models.CharField(max_length=50,  blank=True)

    # Class info
    class_of_admission = models.CharField(max_length=100, blank=True)
    current_class      = models.CharField(max_length=100, blank=True)

    # Withdrawal
    withdrawn          = models.CharField(max_length=3,   choices=WITHDRAWN_CHOICES, default='no')
    class_of_withdrawl = models.CharField(max_length=100, blank=True)

    # Financial
    current_fee        = models.DecimalField(
                            max_digits=10, decimal_places=2,
                            null=True, blank=True,
                            help_text="Individual monthly fee override. Leave blank to use class FeeStructure."
                        )
    arrear_dues        = models.CharField(max_length=50,  blank=True, default='0')

    # Remarks
    remarks            = models.CharField(max_length=1000, blank=True)

    # Login credentials
    email              = models.CharField(max_length=255, blank=True, default='')
    password           = models.CharField(max_length=255, blank=True)

    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['admission_no']

    def __str__(self):
        return f"{self.student_name} ({self.admission_no})"

    @property
    def full_name(self):
        """Kept for backward compatibility."""
        return self.student_name

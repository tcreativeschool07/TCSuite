from rest_framework import serializers
from django.contrib.auth.hashers import make_password
from .models import StudentProfile

# serialize student list information 
class StudentListSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentProfile
        fields = [
            "id", "admission_no", "student_name",
            "f_g_name", "f_g_contact", "current_class",
            "current_fee", "withdrawn", "arrear_dues",
        ]


class StudentDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentProfile
        fields = "__all__"
        extra_kwargs = {
            "password": {"write_only": True}
        }


class StudentCreateUpdateSerializer(serializers.ModelSerializer):

    class Meta:
        model = StudentProfile
        fields = [
            'id',
            'admission_no', 'date_of_admission',
            'student_name',
            'b_form', 'dob', 'religion', 'tribe_caste', 'address',
            'f_g_name', 'f_g_cnic', 'f_g_occupation', 'f_g_contact',
            'class_of_admission', 'current_class',
            'current_fee',
            'withdrawn', 'class_of_withdrawl',
            'arrear_dues', 'remarks',
            'email', 'password',
        ]
        extra_kwargs = {
            "id":                {"read_only": True},
            "password":          {"write_only": True},
            "date_of_admission": {"required": False, "allow_blank": True},
            "dob":               {"required": False, "allow_blank": True},
            "arrear_dues":       {"required": False, "allow_blank": True},
            "email":             {"required": False, "allow_blank": True},
            "b_form":            {"required": False, "allow_blank": True, "allow_null": True},
        }

    def validate_admission_no(self, value):
        qs = StudentProfile.objects.filter(admission_no=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("The admission number is already taken.")
        return value

    def validate_b_form(self, value):
        if not value:
            return None  # store empty as NULL so unique constraint allows multiple blanks
        qs = StudentProfile.objects.filter(b_form=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This B-Form number is already registered.")
        return value

    def validate_email(self, value):
        return value or ''

    def validate_f_g_contact(self, value):
        if value:
            digits = value.replace('-', '').replace(' ', '')
            if digits.isdigit() and len(digits) >= 10 and not value.startswith('0'):
                return '0' + value
        return value

    def validate_f_g_cnic(self, value):
        if not value:
            return value
        digits = value.replace('-', '')
        if not digits.isdigit() or len(digits) != 13:
            raise serializers.ValidationError("CNIC must be 13 digits.")
        return value

    def create(self, validated_data):
        if validated_data.get('password'):
            validated_data['password'] = make_password(validated_data['password'])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if validated_data.get('password'):
            validated_data['password'] = make_password(validated_data['password'])
        return super().update(instance, validated_data)


class StudentFeeInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentProfile
        fields = [
            'id', 'student_name', 'admission_no',
            'current_class', 'current_fee',
            'f_g_name', 'f_g_contact', 'f_g_cnic',
            'arrear_dues',
        ]

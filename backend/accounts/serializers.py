from django.contrib.auth.models import User
from rest_framework import serializers

class AdminProfileSerializer(serializers.ModelSerializer):

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'is_staff']
        read_only_fields = fields
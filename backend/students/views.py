from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import StudentProfile
from .serializers import (
    StudentListSerializer,
    StudentDetailSerializer,
    StudentCreateUpdateSerializer,
)
from fees.models import ClassRoom


class StudentViewSet(viewsets.ModelViewSet):
    queryset        = StudentProfile.objects.all()
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields   = [
        'student_name', 'admission_no', 'b_form',
        'f_g_name', 'f_g_contact',
    ]
    ordering_fields = ['admission_no', 'student_name', 'date_of_admission', 'current_class']

    def get_serializer_class(self):
        if self.action == 'list':
            return StudentListSerializer
        if self.action in ['create', 'update', 'partial_update']:
            return StudentCreateUpdateSerializer
        return StudentDetailSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        current_class = self.request.query_params.get('current_class')
        withdrawn     = self.request.query_params.get('withdrawn')

        if current_class:
            qs = qs.filter(current_class__iexact=current_class)
        if withdrawn:
            qs = qs.filter(withdrawn=withdrawn.lower())
        return qs

    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        """Lightweight enrolment counts for dashboard cards.

        Without this, callers that only need a headcount have to pull the whole
        student list (there is no DRF pagination configured, so `page_size` is
        a no-op) and read its length.
        """
        qs = StudentProfile.objects.all()
        withdrawn = qs.filter(withdrawn='yes').count()
        total = qs.count()
        return Response({
            'total':     total,
            'active':    total - withdrawn,
            'withdrawn': withdrawn,
        })

    @action(detail=False, methods=['get'], url_path='by-class')
    def by_class(self, request):
        classrooms = ClassRoom.objects.filter(is_active=True).order_by('sort_order', 'name')
        students = StudentProfile.objects.exclude(withdrawn='yes').order_by('admission_no')

        groups_map = {}
        for s in students:
            key = (s.current_class or '').strip()
            if key not in groups_map:
                groups_map[key] = []
            groups_map[key].append(StudentListSerializer(s).data)

        result = []
        seen_classes = set()

        for cr in classrooms:
            matched = groups_map.get(cr.name, [])
            if not matched:
                for key, vals in groups_map.items():
                    if key.lower() == cr.name.lower():
                        matched = vals
                        break
            result.append({
                'class_name': cr.name,
                'count': len(matched),
                'students': matched,
            })
            seen_classes.add(cr.name.lower())

        for key, vals in sorted(groups_map.items()):
            if key.lower() not in seen_classes and key:
                result.append({
                    'class_name': key,
                    'count': len(vals),
                    'students': vals,
                })

        return Response(result)

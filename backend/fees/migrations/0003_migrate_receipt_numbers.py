from django.db import migrations


def migrate_receipt_numbers(apps, schema_editor):
    """Convert old RCP-XXXX receipt numbers to YYYYXXXX format."""
    FeeRecord = apps.get_model('fees', 'FeeRecord')
    for rec in FeeRecord.objects.filter(receipt_no__startswith='RCP-'):
        old_seq = rec.receipt_no.split('-')[1]
        rec.receipt_no = f"{rec.year}{old_seq}"
        rec.save(update_fields=['receipt_no'])


class Migration(migrations.Migration):

    dependencies = [
        ('fees', '0002_chargecategory_feerecord_misc_charges_misccharge'),
    ]

    operations = [
        migrations.RunPython(migrate_receipt_numbers, migrations.RunPython.noop),
    ]

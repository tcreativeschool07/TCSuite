"""Put back the foreign keys to students that the composite-PK drift removed.

`fees_feerecord.student_id` and `fees_misccharge.student_id` had no database-level
foreign key: they could not have one while students_studentprofile carried a
composite primary key (see students.0002_restore_single_column_pk). With that key
repaired, the constraints the models have always declared can exist again.

Model state is unchanged — Django already believes these FKs exist — so this is
raw SQL with `state_operations=[]`. Checked before writing: no row in either
table points at a missing student, so both constraints validate.
"""
from django.db import migrations

# (table, constraint name) — the name follows Django's own shape closely enough
# to read naturally in \d output; Django itself locates constraints by column,
# not by name, so nothing depends on matching its hash exactly.
TABLES = [
    ('fees_feerecord',  'fees_feerecord_student_id_fk_students_studentprofile_id'),
    ('fees_misccharge', 'fees_misccharge_student_id_fk_students_studentprofile_id'),
]


def _add(table, name):
    return f"""
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = '{table}'::regclass
           AND contype = 'f'
           AND confrelid = 'students_studentprofile'::regclass
    ) THEN
        ALTER TABLE {table}
            ADD CONSTRAINT {name}
            FOREIGN KEY (student_id) REFERENCES students_studentprofile(id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;
"""


def _drop(table, name):
    return f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name};"


def _run(sql):
    """Skipped on non-PostgreSQL backends — see students.0002 for why."""
    def run(apps, schema_editor):
        if schema_editor.connection.vendor != 'postgresql':
            return
        schema_editor.execute(sql)
    return run


class Migration(migrations.Migration):

    dependencies = [
        ('fees', '0006_customreceipt'),
        ('students', '0002_restore_single_column_pk'),
    ]

    operations = [
        migrations.RunPython(_run(_add(table, name)), _run(_drop(table, name)))
        for table, name in TABLES
    ]

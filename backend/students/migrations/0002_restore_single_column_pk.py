"""Repair schema drift on students_studentprofile.

The live table had grown a composite primary key, `PRIMARY KEY (id, admission_no)`,
instead of the `PRIMARY KEY (id)` the model declares. Two consequences:

* PostgreSQL refuses to create a foreign key referencing `id` alone, because
  `id` on its own carries no unique constraint. Every FK pointing at this table
  had to be dropped when the composite key was introduced, which is why nothing
  in the database referenced students any more — `fees_feerecord.student_id` and
  `fees_misccharge.student_id` were plain integers with no integrity guarantee.
* `admission_no` lost its standalone UNIQUE constraint, so the model's
  `unique=True` was being enforced only by the serializer, in Python.

This migration puts both back. It changes no model state — Django's migration
state already describes the correct schema; only the database had drifted — so
every operation is raw SQL with `state_operations=[]`.

Written defensively: each step checks the current shape first, so it is a no-op
on a database built cleanly from 0001_initial and a repair on a drifted one.
"""
from django.db import migrations


FIX_PRIMARY_KEY = """
DO $$
DECLARE
    pk_name text;
    pk_cols text;
BEGIN
    SELECT c.conname,
           string_agg(a.attname, ',' ORDER BY k.ord)
      INTO pk_name, pk_cols
      FROM pg_constraint c
      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.conrelid = 'students_studentprofile'::regclass
       AND c.contype = 'p'
     GROUP BY c.conname;

    -- Only touch it when it is not already the single-column key we want.
    IF pk_name IS NOT NULL AND pk_cols IS DISTINCT FROM 'id' THEN
        EXECUTE format('ALTER TABLE students_studentprofile DROP CONSTRAINT %I', pk_name);
        ALTER TABLE students_studentprofile ADD PRIMARY KEY (id);
    END IF;

    -- admission_no must be unique on its own, as the model says.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.conrelid = 'students_studentprofile'::regclass
           AND c.contype IN ('u', 'p')
           AND array_length(c.conkey, 1) = 1
           AND a.attname = 'admission_no'
    ) THEN
        ALTER TABLE students_studentprofile
            ADD CONSTRAINT students_studentprofile_admission_no_key UNIQUE (admission_no);
    END IF;
END $$;
"""

# Reversing restores the composite key, purely so the migration is not a one-way
# door. Any FK added on top of the single-column key must be dropped first, which
# `fees.0007_restore_student_fks` reverses before this runs.
UNFIX_PRIMARY_KEY = """
DO $$
DECLARE
    pk_name text;
BEGIN
    ALTER TABLE students_studentprofile
        DROP CONSTRAINT IF EXISTS students_studentprofile_admission_no_key;

    SELECT c.conname INTO pk_name
      FROM pg_constraint c
     WHERE c.conrelid = 'students_studentprofile'::regclass AND c.contype = 'p';

    IF pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE students_studentprofile DROP CONSTRAINT %I', pk_name);
    END IF;
    ALTER TABLE students_studentprofile ADD PRIMARY KEY (id, admission_no);
END $$;
"""


def _run(sql):
    """PL/pgSQL only PostgreSQL understands, so it is skipped elsewhere.

    The drift being repaired only ever existed on the production PostgreSQL
    database; a SQLite database built from these migrations already has the
    correct key. Guarding by vendor keeps the test settings (in-memory SQLite)
    able to build the schema.
    """
    def run(apps, schema_editor):
        if schema_editor.connection.vendor != 'postgresql':
            return
        schema_editor.execute(sql)
    return run


class Migration(migrations.Migration):

    dependencies = [
        ('students', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(_run(FIX_PRIMARY_KEY), _run(UNFIX_PRIMARY_KEY)),
    ]

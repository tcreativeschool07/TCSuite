"""Bring the hand-added `advance` column in line with the model.

The column was created directly on the production database as a nullable
`varchar`, so Django's generated AddField would fail there with "column already
exists". This adapts to whichever situation it finds:

* column missing (a fresh database, or the SQLite one the tests build) — create it;
* column present as text (production) — backfill blanks to 0 and convert it in
  place to numeric(10,2).

It is money, so it is stored as a decimal rather than as text like `arrear_dues`
beside it. All 584 rows were empty when this was written, so the conversion has
nothing to lose.
"""
from django.db import migrations, models

TABLE = 'students_studentprofile'
COLUMN = 'advance'

CONVERT_POSTGRES = """
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'students_studentprofile' AND column_name = 'advance'
    ) THEN
        ALTER TABLE students_studentprofile
            ADD COLUMN advance numeric(10,2) NOT NULL DEFAULT 0;

    ELSIF (
        SELECT data_type FROM information_schema.columns
         WHERE table_name = 'students_studentprofile' AND column_name = 'advance'
    ) <> 'numeric' THEN
        UPDATE students_studentprofile
           SET advance = '0'
         WHERE advance IS NULL OR btrim(advance) = '';

        ALTER TABLE students_studentprofile
            ALTER COLUMN advance TYPE numeric(10,2) USING btrim(advance)::numeric,
            ALTER COLUMN advance SET DEFAULT 0,
            ALTER COLUMN advance SET NOT NULL;
    END IF;
END $$;
"""


def sync_column(apps, schema_editor):
    conn = schema_editor.connection
    if conn.vendor == 'postgresql':
        schema_editor.execute(CONVERT_POSTGRES)
        return

    # Everything else (SQLite under test) builds the schema from scratch, so
    # the column simply will not be there.
    with conn.cursor() as cursor:
        columns = {c.name for c in conn.introspection.get_table_description(cursor, TABLE)}
    if COLUMN not in columns:
        schema_editor.execute(
            f'ALTER TABLE {schema_editor.quote_name(TABLE)} '
            f'ADD COLUMN {schema_editor.quote_name(COLUMN)} '
            f'decimal(10,2) NOT NULL DEFAULT 0'
        )


def drop_column(apps, schema_editor):
    schema_editor.execute(
        f'ALTER TABLE {schema_editor.quote_name(TABLE)} '
        f'DROP COLUMN IF EXISTS {schema_editor.quote_name(COLUMN)}'
    )


class Migration(migrations.Migration):

    dependencies = [
        ('students', '0002_restore_single_column_pk'),
    ]

    operations = [
        # Django's model state gains the field; the database gets whichever of
        # "add" or "convert" it actually needs.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name='studentprofile',
                    name='advance',
                    field=models.DecimalField(
                        decimal_places=2, default=0, max_digits=10,
                        help_text='Unused credit from advance payments, '
                                  'applied automatically to future fees.'),
                ),
            ],
            database_operations=[
                migrations.RunPython(sync_column, drop_column),
            ],
        ),
    ]

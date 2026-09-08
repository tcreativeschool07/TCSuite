"""Create the database cache table that backs the API throttles.

Throttle counters have to be shared by every Gunicorn worker and survive a
restart, so CACHES uses the database backend (see settings.py). That backend
needs its table to exist before the first request; creating it here means a
deploy does it automatically rather than relying on someone remembering to run
`createcachetable` in the build.

`createcachetable` is idempotent — it checks for the table first — so this is
safe to re-run and safe on a database where the table already exists.
"""
from django.core.management import call_command
from django.db import migrations

TABLE = 'django_cache_table'


def create_cache_table(apps, schema_editor):
    call_command('createcachetable', TABLE, verbosity=0)


def drop_cache_table(apps, schema_editor):
    schema_editor.execute(f'DROP TABLE IF EXISTS {schema_editor.quote_name(TABLE)}')


class Migration(migrations.Migration):

    initial = True
    dependencies = []

    operations = [
        migrations.RunPython(create_cache_table, drop_cache_table),
    ]

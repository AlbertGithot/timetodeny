# Generated for Time To Deny model performance controls.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="modelregistry",
            name="auto_select",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="use_for_instant",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="use_for_expert",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="instant_context_messages",
            field=models.PositiveSmallIntegerField(default=4),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="expert_context_messages",
            field=models.PositiveSmallIntegerField(default=12),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="instant_max_tokens",
            field=models.PositiveIntegerField(default=512),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="expert_max_tokens",
            field=models.PositiveIntegerField(default=2048),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="llama_context_size",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="llama_threads",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="llama_gpu_layers",
            field=models.IntegerField(default=-1),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="prompt_cache_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="run_tests",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="modelregistry",
            name="max_test_files",
            field=models.PositiveSmallIntegerField(default=2),
        ),
    ]

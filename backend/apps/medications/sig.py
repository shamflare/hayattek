"""Render a structured prescription item as Arabic instructions (the 'sig').

Rendering lives on the server so web, mobile and print show identical text.
"""

from decimal import Decimal

from .models import DurationUnit, MealRelation, ScheduleType, TimeOfDay, Weekday

_TIMES = {TimeOfDay.MORNING: "صباحاً", TimeOfDay.NOON: "ظهراً", TimeOfDay.EVENING: "مساءً",
          TimeOfDay.BEDTIME: "قبل النوم"}
_TIME_ORDER = [TimeOfDay.MORNING, TimeOfDay.NOON, TimeOfDay.EVENING, TimeOfDay.BEDTIME]
_WEEKDAYS = dict(Weekday.choices)
_MEALS = dict(MealRelation.choices)


def _num(value) -> str:
    if value is None:
        return ""
    value = Decimal(value).normalize()
    text = format(value, "f")
    return {"0.5": "نصف", "0.25": "ربع", "1.5": "واحد ونصف"}.get(text, text)


def _times_per_day(n: int) -> str:
    return {1: "مرة واحدة يومياً", 2: "مرتين يومياً", 3: "ثلاث مرات يومياً",
            4: "أربع مرات يومياً"}.get(n, f"{n} مرات يومياً")


def _duration(item) -> str:
    if item.duration_unit == DurationUnit.ONGOING:
        return "بشكل مستمر"
    if item.end_date:
        return f"حتى {item.end_date:%Y/%m/%d}"
    if item.duration_value and item.duration_unit:
        unit = {"days": ("يوم", "أيام"), "weeks": ("أسبوع", "أسابيع"),
                "months": ("شهر", "أشهر")}[item.duration_unit]
        v = item.duration_value
        if v == 1:
            return f"لمدة {unit[0]}"
        if v == 2:
            return {"days": "لمدة يومين", "weeks": "لمدة أسبوعين", "months": "لمدة شهرين"}[
                item.duration_unit]
        return f"لمدة {v} {unit[1] if v <= 10 else unit[0]}"
    return ""


def render_sig(item) -> str:
    parts: list[str] = []
    if item.dose_amount is not None:
        parts.append(" ".join(p for p in [_num(item.dose_amount), item.dose_unit] if p))

    schedule = item.schedule_type
    if schedule == ScheduleType.TIMES_OF_DAY and item.times_of_day:
        ordered = [_TIMES[t] for t in _TIME_ORDER if t in item.times_of_day]
        parts.append(" و".join(ordered))
    elif schedule == ScheduleType.TIMES_PER_DAY and item.times_per_day:
        parts.append(_times_per_day(item.times_per_day))
    elif schedule == ScheduleType.EVERY_HOURS and item.interval_hours:
        parts.append(f"كل {item.interval_hours} ساعات" if item.interval_hours <= 10
                     else f"كل {item.interval_hours} ساعة")
    elif schedule == ScheduleType.EVERY_DAYS and item.interval_days:
        parts.append("يوماً بعد يوم" if item.interval_days == 2
                     else f"كل {item.interval_days} أيام")
    elif schedule == ScheduleType.WEEKLY and item.weekdays:
        parts.append("أيام " + "، ".join(_WEEKDAYS[d] for d in item.weekdays))
    elif schedule == ScheduleType.AS_NEEDED:
        parts.append("عند الحاجة" + (f" ({item.as_needed_reason})" if item.as_needed_reason
                                     else ""))
    elif schedule == ScheduleType.SINGLE_DOSE:
        parts.append("جرعة واحدة")

    if item.meal_relation and item.meal_relation != MealRelation.INDEPENDENT:
        parts.append(_MEALS[item.meal_relation])
    duration = _duration(item)
    if duration:
        parts.append(duration)
    text = " ".join(p for p in parts if p)
    if item.instructions:
        text = f"{text} — {item.instructions}" if text else item.instructions
    return text

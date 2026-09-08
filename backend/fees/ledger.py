"""Ledger rules for fee records.

A student's fee records form a running ledger: each period's `previous_balance`
is whatever the student still owed from before it — legacy arrears they came in
with, plus the unpaid fee and charges of every earlier period. This module owns
that derivation, and the routing of an "arrears" payment to the month(s) it
actually settles, so a June fee paid in August lands on the June record (tagged
late) and August's arrears shrink to match.
"""
from decimal import Decimal

from django.utils import timezone

from .models import FeeRecord

ZERO = Decimal(0)

# Statuses whose balance is forced to zero and therefore never carries forward.
SETTLED = ('waived', 'advance')


class LedgerError(Exception):
    """A payment that cannot be applied as asked (over a cap, bad target)."""


def period(r):
    return (r.year, r.month)


def _d(v):
    return Decimal(v or 0)


def own_outstanding(r):
    """What this record still owes for its own period (fee + misc), arrears aside."""
    if r.status in SETTLED:
        return ZERO
    fee  = max(ZERO, _d(r.current_fee) - _d(r.paid_current_fee))
    misc = max(ZERO, _d(r.misc_charges) - _d(r.paid_misc_charges))
    return fee + misc


def student_records(student):
    return list(FeeRecord.objects.filter(student=student).order_by('year', 'month', 'id'))


def legacy_remaining(records):
    """Arrears the student brought in before any record existed.

    Seeded on the earliest record's previous_balance (the one value in the chain
    that is never re-derived); every paid_previous_balance anywhere counts
    against it, since arrears payments are always routed to where they originated.
    """
    if not records:
        return ZERO
    seed = _d(records[0].previous_balance)
    paid = sum((_d(r.paid_previous_balance) for r in records), ZERO)
    return max(ZERO, seed - paid)


def seed_from_profile(student):
    try:
        return Decimal(int(student.arrear_dues or 0))
    except (ValueError, TypeError):
        return ZERO


def opening_balance(student, month, year, records=None):
    """previous_balance for a record at (month, year).

    No earlier records → the profile's arrear_dues seed. Otherwise legacy
    arrears still unpaid plus every earlier period's own outstanding.
    """
    if records is None:
        records = student_records(student)
    earlier = [r for r in records if period(r) < (year, month)]
    if not earlier:
        return seed_from_profile(student)
    return legacy_remaining(records) + sum((own_outstanding(r) for r in earlier), ZERO)


def recompute_chain(student):
    """Re-derive previous_balance down the student's ledger after anything
    earlier changed. The earliest record keeps its seed; waived/advance records
    are left untouched (their balance is forced to zero)."""
    records = student_records(student)
    if not records:
        return
    running = legacy_remaining(records)
    for i, r in enumerate(records):
        if i == 0:
            running += own_outstanding(r)
            continue
        if r.status in SETTLED:
            continue
        if _d(r.previous_balance) != running:
            r.previous_balance = running
            r.save()
        running += own_outstanding(r)


def is_late(record, today=None):
    """A payment recorded after the record's month has ended is a late payment."""
    today = today or timezone.localdate()
    return (today.year, today.month) > (record.year, record.month)


def arrears_breakdown(record, records=None):
    """Where this record's arrears come from, for the payment dialog."""
    if records is None:
        records = student_records(record.student)
    earlier = [r for r in records if period(r) < period(record)]
    month_names = dict(FeeRecord.MONTH_CHOICES)

    if not earlier:
        legacy = max(ZERO, _d(record.previous_balance) - _d(record.paid_previous_balance))
        periods = []
    else:
        legacy = legacy_remaining(records)
        periods = []
        for r in earlier:
            out = own_outstanding(r)
            if out <= 0:
                continue
            periods.append({
                'id': r.id,
                'month': r.month,
                'month_name': month_names.get(r.month, ''),
                'year': r.year,
                'fee_outstanding': float(max(ZERO, _d(r.current_fee) - _d(r.paid_current_fee))),
                'misc_outstanding': float(max(ZERO, _d(r.misc_charges) - _d(r.paid_misc_charges))),
                'outstanding': float(out),
                'status': r.status,
                'is_late': r.is_late,
            })

    total = legacy + sum((Decimal(str(p['outstanding'])) for p in periods), ZERO)
    return {
        'legacy': float(legacy),
        'periods': periods,
        'total': float(total),
        # True when the arrears can be attributed to specific earlier months.
        'routable': bool(earlier),
    }


def student_advance(student):
    """The credit a student currently holds, as a Decimal."""
    try:
        return max(ZERO, Decimal(student.advance or 0))
    except (TypeError, ValueError, ArithmeticError):
        return ZERO


def take_advance(student, amount_due):
    """Draw down as much of the student's advance as `amount_due` can absorb.

    Returns what was drawn. The caller is responsible for saving the student —
    every call site here writes the whole batch at once rather than one row per
    student, so this only adjusts the in-memory value.

    An advance is money the school already holds, so what it covers is recorded
    as paid rather than as a discount: the record's total stays honest and the
    balance falls because it has been settled.
    """
    available = student_advance(student)
    if available <= 0 or amount_due <= 0:
        return ZERO
    used = min(available, amount_due)
    student.advance = available - used
    return used


def outstanding_items(student):
    """Everything this student still owes, as pickable lines.

    One line per thing that can be charged for separately — the arrears they
    enrolled with, and each period's unpaid fee and unpaid charges kept apart —
    so a hand-built receipt can include some and leave out others. Oldest first.
    """
    records = student_records(student)
    month_names = dict(FeeRecord.MONTH_CHOICES)
    items = []

    legacy = legacy_remaining(records)
    if legacy > 0:
        items.append({
            'key': 'legacy',
            'kind': 'arrear',
            'label': 'Arrears brought forward',
            'amount': float(legacy),
            'record': None, 'month': None, 'year': None,
        })

    for r in records:
        if r.status in SETTLED:
            continue
        period_label = f"{month_names.get(r.month, '')} {r.year}".strip()
        fee_out  = max(ZERO, _d(r.current_fee) - _d(r.paid_current_fee))
        misc_out = max(ZERO, _d(r.misc_charges) - _d(r.paid_misc_charges))
        if fee_out > 0:
            items.append({
                'key': f'fee-{r.id}',
                'kind': 'fee',
                'label': f"Tuition fee - {period_label}",
                'amount': float(fee_out),
                'record': r.id, 'month': r.month, 'year': r.year,
            })
        if misc_out > 0:
            items.append({
                'key': f'misc-{r.id}',
                'kind': 'misc',
                'label': f"Other charges - {period_label}",
                'amount': float(misc_out),
                'record': r.id, 'month': r.month, 'year': r.year,
            })

    return items


def arrears_cap(record, target=None, records=None):
    """The most that can be paid against arrears for the chosen target."""
    bd = arrears_breakdown(record, records)
    if target in (None, '', 'auto'):
        return Decimal(str(bd['total']))
    if target == 'legacy':
        return Decimal(str(bd['legacy']))
    for p in bd['periods']:
        if str(p['id']) == str(target):
            return Decimal(str(p['outstanding']))
    raise LedgerError("That month is not an earlier unpaid record for this student.")


def route_arrears_payment(record, amount, target=None, today=None):
    """Apply `amount` paid against arrears on `record` to what it settles.

    target: None/'auto' (oldest dues first), 'legacy' (balance from before any
    record), or an earlier record's id. Earlier records receiving money are
    tagged late. Returns the records written (not including `record`, which the
    caller saves; its previous_balance is then re-derived by recompute_chain).
    """
    amount = Decimal(amount)
    if amount <= 0:
        return []
    records = student_records(record.student)
    earlier = [r for r in records if period(r) < period(record)]
    today = today or timezone.localdate()
    month_names = dict(FeeRecord.MONTH_CHOICES)

    # Nothing earlier: the arrears live on this record itself.
    if not earlier:
        cap = max(ZERO, _d(record.previous_balance) - _d(record.paid_previous_balance))
        if amount > cap:
            raise LedgerError(f"Only Rs {cap:.0f} outstanding against arrears.")
        record.paid_previous_balance = _d(record.paid_previous_balance) + amount
        return []

    earliest = records[0]
    legacy = legacy_remaining(records)
    touched = {}   # id -> (record, mark_late)

    def pay_legacy(x):
        earliest.paid_previous_balance = _d(earliest.paid_previous_balance) + x
        touched.setdefault(earliest.id, [earliest, False])

    def pay_period(r, x):
        fee_out = max(ZERO, _d(r.current_fee) - _d(r.paid_current_fee))
        take = min(x, fee_out)
        r.paid_current_fee = _d(r.paid_current_fee) + take
        x -= take
        if x > 0:
            r.paid_misc_charges = _d(r.paid_misc_charges) + x
        entry = touched.setdefault(r.id, [r, False])
        entry[1] = True

    if target == 'legacy':
        if amount > legacy:
            raise LedgerError(f"Only Rs {legacy:.0f} outstanding from before the first record.")
        pay_legacy(amount)
    elif target not in (None, '', 'auto'):
        r = next((x for x in earlier if str(x.id) == str(target)), None)
        if r is None:
            raise LedgerError("That month is not an earlier record for this student.")
        cap = own_outstanding(r)
        if amount > cap:
            raise LedgerError(
                f"Only Rs {cap:.0f} outstanding for {month_names.get(r.month, '')} {r.year}.")
        pay_period(r, amount)
    else:
        total = legacy + sum((own_outstanding(r) for r in earlier), ZERO)
        if amount > total:
            raise LedgerError(f"Only Rs {total:.0f} outstanding against arrears.")
        remaining = amount
        take = min(remaining, legacy)
        if take > 0:
            pay_legacy(take)
            remaining -= take
        for r in earlier:
            if remaining <= 0:
                break
            cap = own_outstanding(r)
            if cap <= 0:
                continue
            take = min(remaining, cap)
            pay_period(r, take)
            remaining -= take

    written = []
    for r, mark_late in touched.values():
        if mark_late:
            r.is_late = True
            r.late_paid_on = today
        # This is the day that month was actually settled, which is what its
        # receipt should show — not the day the arrears first appeared.
        r.payment_date = today
        r.amount_paid = r.allocation_total()
        r.save()
        written.append(r)
    return written


def route_arrears_allocations(record, allocations, today=None):
    """Apply several arrears amounts at once, each to the month it settles.

    allocations: [{'target': 'legacy', 'amount': X},
                  {'target': <earlier record id>, 'fee': X, 'misc': Y}, ...]
    Fee and charges are capped separately per month. Earlier records receiving
    money are tagged late. Returns the records written (not `record` itself).
    """
    records = student_records(record.student)
    earlier = [r for r in records if period(r) < period(record)]
    today = today or timezone.localdate()
    month_names = dict(FeeRecord.MONTH_CHOICES)
    touched = {}
    legacy = legacy_remaining(records)
    earliest = records[0] if records else None

    for a in allocations or []:
        target = str(a.get('target', '') or '')
        if target == 'legacy':
            amt = Decimal(str(a.get('amount') or a.get('fee') or 0))
            if amt <= 0:
                continue
            if not earlier:
                # No earlier record: the legacy balance lives on this record.
                cap = max(ZERO, _d(record.previous_balance) - _d(record.paid_previous_balance))
                if amt > cap:
                    raise LedgerError(f"Only Rs {cap:.0f} outstanding against arrears.")
                record.paid_previous_balance = _d(record.paid_previous_balance) + amt
                continue
            if amt > legacy:
                raise LedgerError(f"Only Rs {legacy:.0f} outstanding from before the first record.")
            legacy -= amt
            earliest.paid_previous_balance = _d(earliest.paid_previous_balance) + amt
            touched.setdefault(earliest.id, [earliest, False])
            continue

        r = next((x for x in earlier if str(x.id) == target), None)
        if r is None:
            raise LedgerError("That month is not an earlier record for this student.")
        fee  = Decimal(str(a.get('fee') or 0))
        misc = Decimal(str(a.get('misc') or 0))
        if fee <= 0 and misc <= 0:
            continue
        label = f"{month_names.get(r.month, '')} {r.year}"
        if r.status in SETTLED:
            raise LedgerError(f"{label} is {r.status}; nothing is owed for it.")
        fee_out  = max(ZERO, _d(r.current_fee) - _d(r.paid_current_fee))
        misc_out = max(ZERO, _d(r.misc_charges) - _d(r.paid_misc_charges))
        if fee > fee_out:
            raise LedgerError(f"Only Rs {fee_out:.0f} fee outstanding for {label}.")
        if misc > misc_out:
            raise LedgerError(f"Only Rs {misc_out:.0f} in charges outstanding for {label}.")
        r.paid_current_fee  = _d(r.paid_current_fee) + fee
        r.paid_misc_charges = _d(r.paid_misc_charges) + misc
        entry = touched.setdefault(r.id, [r, False])
        entry[1] = True

    written = []
    for r, mark_late in touched.values():
        if mark_late:
            r.is_late = True
            r.late_paid_on = today
        # This is the day that month was actually settled, which is what its
        # receipt should show — not the day the arrears first appeared.
        r.payment_date = today
        r.amount_paid = r.allocation_total()
        r.save()
        written.append(r)
    return written

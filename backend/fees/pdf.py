# for invoice generation in PDF format
import io
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable,
    PageBreak, KeepTogether,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.pdfbase import pdfmetrics
from django.utils import timezone

MONTHS = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]

SCHOOL_NAME = "The Creative School"


def _num(v):
    try:
        return f"Rs {int(float(v)):,}"
    except (ValueError, TypeError):
        return "Rs 0"


def _fmt_receipt(r):
    """Format receipt number: 20260001 → 2026-0001"""
    r = str(r or '')
    if len(r) == 8 and r.isdigit():
        return f"{r[:4]}-{r[4:]}"
    return r


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle('SchoolName', parent=ss['Heading1'], fontSize=18,
                          textColor=colors.HexColor('#1d4ed8'), alignment=TA_CENTER, spaceAfter=2))
    ss.add(ParagraphStyle('SubTitle', parent=ss['Normal'], fontSize=10,
                          textColor=colors.gray, alignment=TA_CENTER, spaceAfter=6))
    ss.add(ParagraphStyle('InvoiceTitle', parent=ss['Heading2'], fontSize=13,
                          alignment=TA_CENTER, spaceAfter=10))
    ss.add(ParagraphStyle('SectionHead', parent=ss['Heading3'], fontSize=10,
                          textColor=colors.HexColor('#1d4ed8'), spaceAfter=4))
    ss.add(ParagraphStyle('Small', parent=ss['Normal'], fontSize=8, textColor=colors.gray))
    ss.add(ParagraphStyle('RightSmall', parent=ss['Normal'], fontSize=8,
                          textColor=colors.gray, alignment=TA_RIGHT))
    ss.add(ParagraphStyle('CenterSmall', parent=ss['Normal'], fontSize=8,
                          textColor=colors.gray, alignment=TA_CENTER))
    return ss

# ══════════════════════════════════════════════════════════════════════
#  RECEIPTS
#  One receipt per student — the old Student Copy / Office Copy pair is
#  gone. Every receipt itemises the month being billed *and* each earlier
#  month still owed, so the arrears figure is never an unexplained lump.
#  A student with a long arrears history needs more room than a quarter
#  page, so their receipt claims half a page instead (see _receipt_height).
# ══════════════════════════════════════════════════════════════════════

ACCENT     = colors.HexColor('#1E5C48')   # deep green, the one accent
ACCENT_BG  = colors.HexColor('#EDF4F0')
INK        = colors.HexColor('#20241F')
INK_SOFT   = colors.HexColor('#6B7168')
RULE       = colors.HexColor('#D8D7D0')
DANGER     = colors.HexColor('#A23B32')
DANGER_BG  = colors.HexColor('#FBF0EE')

PAD        = 11      # inner padding of a receipt band
ROW_H      = 11      # one money-table row
FIELD_H    = 11.5    # one student-detail row
HEAD_H     = 32      # school name + subtitle + rule
FOOT_H     = 26      # signature strip + footnote
TABLE_HEAD = 13      # the Description/Amount rule
DUE_H      = 14      # each closing line under the table (due date / paid on)


def _money(v):
    try:
        n = int(round(float(v or 0)))
    except (TypeError, ValueError):
        return "0"
    # Deductions are stored negative so the column still sums to the total.
    return f"-{abs(n):,}" if n < 0 else f"{n:,}"


def _f(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _fmt_date(value):
    """2026-06-10 -> 10 June 2026. Anything unparseable passes straight through."""
    if not value:
        return ''
    text = str(value)
    try:
        y, m, d = (int(part) for part in text[:10].split('-'))
        return f"{d} {MONTHS[m]} {y}"
    except (ValueError, IndexError):
        return text


def _month_of(record):
    try:
        m = int(record.get('month') or 0)
    except (TypeError, ValueError):
        return ''
    return MONTHS[m] if 1 <= m <= 12 else ''


def _ellipsize(text, font, size, max_w):
    text = str(text or '')
    if pdfmetrics.stringWidth(text, font, size) <= max_w:
        return text
    while text and pdfmetrics.stringWidth(text + '...', font, size) > max_w:
        text = text[:-1]
    return text + '...'


def _arrear_rows(record, cap=None):
    """One line per earlier month still owed, oldest first.

    Driven by the ledger breakdown the view attaches as `arrears`; the lines
    are reconciled against previous_balance so a receipt always adds up even
    when the breakdown is missing or stale.
    """
    prev = _f(record.get('previous_balance'))
    if prev <= 0 or cap == 0:
        return []

    ar = record.get('arrears') or {}
    rows = []
    listed = 0.0

    legacy = _f(ar.get('legacy'))
    if legacy > 0:
        rows.append(('Arrears brought forward', legacy))
        listed += legacy

    for p in (ar.get('periods') or []):
        amount = _f(p.get('outstanding'))
        if amount <= 0:
            continue
        rows.append((f"Arrears - {p.get('month_name', '')} {p.get('year', '')}".strip(), amount))
        listed += amount

    residual = round(prev - listed, 2)
    if not rows:
        rows.append(('Previous balance', prev))
    elif residual > 0.5:
        rows.append(('Arrears - earlier dues', residual))

    # Too many months to print: keep the oldest, roll the rest into one line
    # so the column still totals to previous_balance.
    if cap is not None and len(rows) > cap:
        keep = rows[:max(cap - 1, 1)]
        folded = sum(a for _, a in rows[len(keep):])
        keep.append((f"Arrears - {len(rows) - len(keep)} earlier months", folded))
        rows = keep
    return rows


def _receipt_rows(record, arrear_cap=None):
    """The money table: [(label, amount, kind)] — what is billed, then totals."""
    # A hand-built receipt carries its own lines: the office picked exactly what
    # to charge for, so they print verbatim instead of being derived from a
    # period's billing. Nothing has been paid against it, so it closes on one
    # payable figure rather than the due/paid/balance trio.
    items = record.get('custom_items')
    if items is not None:
        rows = [(i.get('label', ''), _f(i.get('amount')),
                 'arrear' if i.get('kind') == 'arrear' else 'item')
                for i in items]
        rows.append(('Total payable', _f(record.get('total_amount')), 'balance'))
        return rows

    period = f"{_month_of(record)} {record.get('year', '')}".strip()

    rows = [(f"Tuition fee - {period}", _f(record.get('current_fee')), 'item')]

    misc = _f(record.get('misc_charges'))
    if misc > 0:
        rows.append((f"Other charges - {period}", misc, 'item'))

    rows += [(label, amount, 'arrear')
             for label, amount in _arrear_rows(record, arrear_cap)]

    rows.append(('Total due', _f(record.get('total_amount')), 'total'))

    # Credit the school was already holding, shown as its own deduction so a
    # parent can see why they are being asked for less than the total. It is
    # part of amount_paid, so the cash line below nets it out.
    advance = _f(record.get('advance_applied'))
    if advance > 0:
        rows.append(('Less: advance adjusted', -advance, 'advance'))
        cash = _f(record.get('amount_paid')) - advance
        if cash > 0:
            rows.append(('Amount paid', cash, 'paid'))
    else:
        rows.append(('Amount paid', _f(record.get('amount_paid')), 'paid'))

    rows.append(('Balance due', _f(record.get('balance')), 'balance'))
    return rows


def _closing_lines(record):
    """The lines under the money table: the deadline, and the date paid.

    "Due date" is dropped once nothing is owed — a settled receipt should lead
    with when it was paid, not with a deadline that no longer applies.
    """
    lines = []
    if record.get('due_date') and _f(record.get('balance')) > 0:
        lines.append(('Due date', _fmt_date(record['due_date']), 'due'))
    if record.get('payment_date'):
        lines.append(('Paid on', _fmt_date(record['payment_date']), 'paid'))
    return lines


def _receipt_height(record, arrear_cap=None):
    """Points this receipt needs. Drives the quarter-page vs half-page choice."""
    table   = TABLE_HEAD + len(_receipt_rows(record, arrear_cap)) * ROW_H + 8
    table  += len(_closing_lines(record)) * DUE_H
    details = 5 * FIELD_H + 4
    return PAD * 2 + HEAD_H + max(table, details) + FOOT_H


def _arrear_cap_for(record, height):
    """Most arrears lines that fit in `height`; None when they all do."""
    room = height - (PAD * 2 + HEAD_H + FOOT_H + TABLE_HEAD + 8)
    room -= len(_closing_lines(record)) * DUE_H
    # The rows that are always there — this month's billing plus the three
    # totals. Counted from the built rows so it can't drift out of step with
    # _receipt_height(), which sizes the box from the same list.
    fixed = sum(1 for _, _, kind in _receipt_rows(record) if kind != 'arrear')
    allowed = int(room // ROW_H) - fixed
    if allowed >= len(_arrear_rows(record)):
        return None
    return max(allowed, 1)


def _generated_stamp():
    """When this document was produced, in the school's timezone.

    Every receipt in one run carries the same stamp, so a batch handed out
    together can be told apart from a reprint later.
    """
    return f"Generated {timezone.localtime():%d %b %Y, %I:%M %p}"


def _draw_receipt(c, x, y, w, h, record, generated=None):
    """Draw one receipt inside the box at (x, y) sized w x h."""
    rows = _receipt_rows(record, _arrear_cap_for(record, h))
    s = record.get('student', {}) or {}

    left, right = x + PAD, x + w - PAD
    inner_w = w - 2 * PAD
    top = y + h - PAD

    c.setStrokeColor(RULE)
    c.setLineWidth(0.7)
    c.setDash([])
    c.roundRect(x, y, w, h, 5)

    # Header
    c.setFillColor(ACCENT)
    c.setFont('Helvetica-Bold', 11.5)
    c.drawString(left, top - 10, SCHOOL_NAME)

    # A hand-built receipt spans whatever months the office picked, so it has no
    # single period to name in the subtitle.
    period_label = f"{_month_of(record)} {record.get('year', '')}".strip()
    c.setFillColor(INK_SOFT)
    c.setFont('Helvetica', 7)
    c.drawString(left, top - 20.5,
                 f"Fee Receipt  ·  {period_label}" if period_label else 'Fee Receipt')

    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 10.5)
    c.drawRightString(right, top - 10, _fmt_receipt(record.get('receipt_no')))
    c.setFillColor(INK_SOFT)
    c.setFont('Helvetica', 6.5)
    c.drawRightString(right, top - 20.5,
                      f"Issued {_fmt_date(record.get('receipt_date'))}")

    rule_y = top - 27
    c.setStrokeColor(ACCENT)
    c.setLineWidth(0.9)
    c.line(left, rule_y, right, rule_y)

    body_top = rule_y - 13
    col_w = inner_w * 0.42
    table_x0 = left + col_w + 16

    # Student details
    label_w = 60
    value_x = left + label_w
    value_w = col_w - label_w
    fields = [
        ('Student',   s.get('student_name', '')),
        ('Admission', s.get('admission_no', '')),
        ('Class',     s.get('current_class', '')),
        ('Guardian',  s.get('f_g_name', '')),
        ('Contact',   s.get('f_g_contact', '')),
    ]
    fy = body_top
    for label, value in fields:
        c.setFillColor(INK_SOFT)
        c.setFont('Helvetica', 6.5)
        c.drawString(left, fy, label)
        c.setFillColor(INK)
        c.setFont('Helvetica-Bold', 8)
        c.drawString(value_x, fy, _ellipsize(value, 'Helvetica-Bold', 8, value_w))
        fy -= FIELD_H

    # Money table
    table_w = right - table_x0
    c.setFillColor(INK_SOFT)
    c.setFont('Helvetica-Bold', 6)
    c.drawString(table_x0, body_top, 'DESCRIPTION')
    c.drawRightString(right, body_top, 'AMOUNT (RS)')
    c.setStrokeColor(RULE)
    c.setLineWidth(0.5)
    c.line(table_x0, body_top - 4.5, right, body_top - 4.5)

    ty = body_top - 4.5
    for label, amount, kind in rows:
        ty -= ROW_H
        baseline = ty + 3

        if kind == 'total':
            c.setStrokeColor(RULE)
            c.setLineWidth(0.5)
            c.line(table_x0, ty + ROW_H - 1.5, right, ty + ROW_H - 1.5)
        if kind == 'balance':
            c.setFillColor(DANGER_BG if amount > 0 else ACCENT_BG)
            c.rect(table_x0 - 3, ty - 1, table_w + 6, ROW_H, fill=1, stroke=0)

        bold = kind in ('total', 'balance')
        indent = 6 if kind == 'arrear' else 0
        font = 'Helvetica-Bold' if bold else 'Helvetica'

        c.setFillColor(INK_SOFT if kind == 'arrear' else INK)
        c.setFont(font, 7.5)
        c.drawString(table_x0 + indent, baseline,
                     _ellipsize(label, font, 7.5, table_w - 62 - indent))

        if kind == 'balance':
            c.setFillColor(DANGER if amount > 0 else ACCENT)
        elif kind == 'arrear':
            c.setFillColor(INK_SOFT)
        elif kind == 'advance':
            c.setFillColor(ACCENT)
        else:
            c.setFillColor(INK)
        c.setFont(font, 7.5)
        c.drawRightString(right, baseline, _money(amount))

    # The deadline to meet, and the day it was settled. These read as the last
    # lines of the money table, under the balance, which is where the eye lands
    # — both used to be 5.5pt grey in the footnote, effectively invisible.
    for label, value, kind in _closing_lines(record):
        ty -= DUE_H
        baseline = ty + 4
        c.setFillColor(INK_SOFT)
        c.setFont('Helvetica', 7)
        c.drawString(table_x0, baseline, label)
        c.setFillColor(DANGER if kind == 'due' else ACCENT)
        c.setFont('Helvetica-Bold', 7.5)
        c.drawRightString(right, baseline, value)

    # Signatures + footnote
    sig_y = y + PAD + 12
    c.setStrokeColor(RULE)
    c.setLineWidth(0.5)
    c.setDash([])
    c.line(left, sig_y + 9, left + 88, sig_y + 9)
    c.line(left + 104, sig_y + 9, left + 192, sig_y + 9)
    c.setFillColor(INK_SOFT)
    c.setFont('Helvetica', 6)
    c.drawString(left, sig_y, 'Parent / Guardian')
    c.drawString(left + 104, sig_y, 'Accounts Officer')

    # Due date and payment date both have their own lines above now; this is
    # when the sheet itself was printed.
    notes = [generated or _generated_stamp(), 'Computer-generated receipt']
    c.setFillColor(colors.HexColor('#9A9F97'))
    c.setFont('Helvetica', 5.5)
    c.drawRightString(right, sig_y, '  ·  '.join(notes))


def generate_bulk_invoices_pdf(records):
    """Receipts for a whole class: four to an A4 page, one copy each.

    An ordinary receipt is exactly a quarter page, so four fit and the page cuts
    into four equal slips. A student whose arrears run over several months needs
    more room, so their receipt grows to what it needs — up to half a page — and
    the rest of the class flows on after it. Receipts stay in the order given
    (admission number), because staff hand the slips out in that order.
    """
    buf = io.BytesIO()
    page_w, page_h = A4
    c = pdfcanvas.Canvas(buf, pagesize=A4)

    margin = 9 * mm
    gap    = 3 * mm
    slots  = 4
    usable = page_h - 2 * margin
    slot_h = (usable - gap * (slots - 1)) / slots   # a quarter page
    tall_h = slot_h * 2 + gap                       # the half-page ceiling
    width  = page_w - 2 * margin

    def flush(cut_ys):
        """Dashed guides where one receipt ends and the next begins."""
        c.setStrokeColor(colors.HexColor('#C9C8C1'))
        c.setLineWidth(0.4)
        c.setDash(3, 3)
        for cut_y in cut_ys:
            c.line(margin - 4 * mm, cut_y, page_w - margin + 4 * mm, cut_y)
        c.setDash([])
        c.showPage()

    generated = _generated_stamp()      # one stamp for the whole batch
    cursor = page_h - margin    # top edge of the next receipt
    cuts   = []
    for record in records:
        height = min(max(_receipt_height(record), slot_h), tall_h)

        if cursor - height < margin and cuts:
            flush(cuts[:-1])
            cursor, cuts = page_h - margin, []

        _draw_receipt(c, margin, cursor - height, width, height, record, generated)
        cursor -= height + gap
        cuts.append(cursor + gap / 2)

    if cuts:
        flush(cuts[:-1])

    c.save()
    buf.seek(0)
    return buf.read()


def generate_student_invoice_pdf(record):
    """A single student's receipt, on its own page."""
    buf = io.BytesIO()
    page_w, page_h = A4
    c = pdfcanvas.Canvas(buf, pagesize=A4)

    margin = 18 * mm
    width  = page_w - 2 * margin
    height = min(max(_receipt_height(record) + 25 * mm, 105 * mm),
                 page_h - 2 * margin)

    _draw_receipt(c, margin, page_h - margin - height, width, height, record)

    c.save()
    buf.seek(0)
    return buf.read()


def generate_balance_sheet_pdf(data):
    
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=(A4[1], A4[0]),
                            topMargin=10*mm, bottomMargin=10*mm,
                            leftMargin=10*mm, rightMargin=10*mm)
    ss = _styles()
    story = []

    year = data.get('year', '')
    ys = data.get('yearly_summary', {})

    story.append(Paragraph(SCHOOL_NAME, ss['SchoolName']))
    story.append(Paragraph(f"Balance Sheet — Annual Financial Report — {year}", ss['SubTitle']))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#1d4ed8'),
                            spaceAfter=8))

    # Annual Summary 
    story.append(Paragraph("Annual Summary", ss['SectionHead']))
    sum_data = [
        ['Total Students', 'Total Records', 'Total Fee', 'Arrears Carried',
         'Total Due', 'Collected', 'Outstanding', 'Collection Rate'],
        [
            str(ys.get('total_students', 0)),
            str(ys.get('total_records', 0)),
            _num(ys.get('total_fee', 0)),
            _num(ys.get('total_prev_balance', 0)),
            _num(ys.get('total_due', 0)),
            _num(ys.get('total_collected', 0)),
            _num(ys.get('total_balance', 0)),
            f"{ys.get('collection_rate', 0)}%",
        ],
    ]
    sum_t = Table(sum_data, colWidths=[70, 65, 80, 80, 80, 80, 80, 80])
    sum_t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1d4ed8')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#d1d5db')),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#eff6ff')),
        ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
    ]))
    story.append(sum_t)
    story.append(Spacer(1, 6))

    status_line = (
        f"Paid: {ys.get('paid', 0)}   |   "
        f"Partial: {ys.get('partial', 0)}   |   "
        f"Unpaid: {ys.get('unpaid', 0)}"
    )
    story.append(Paragraph(status_line, ss['CenterSmall']))
    story.append(Spacer(1, 12))

    # Monthly Breakdown 
    monthly = data.get('monthly', [])
    if monthly:
        story.append(Paragraph("Month-by-Month Breakdown", ss['SectionHead']))
        header = ['Month', 'Records', 'Monthly Fee', 'Prev Balance',
                  'Total Due', 'Collected', 'Outstanding', 'Rate', 'Paid', 'Partial', 'Unpaid']
        rows = [header]
        for m in monthly:
            rate = round(m['total_collected'] / m['total_due'] * 100, 1) if m['total_due'] > 0 else 0
            rows.append([
                m.get('month_name', ''),
                str(m.get('records', 0)),
                _num(m.get('total_fee', 0)),
                _num(m.get('prev_balance', 0)),
                _num(m.get('total_due', 0)),
                _num(m.get('total_collected', 0)),
                _num(m.get('total_balance', 0)),
                f"{rate}%",
                str(m.get('paid', 0)),
                str(m.get('partial', 0)),
                str(m.get('unpaid', 0)),
            ])

        rows.append([
            'TOTAL',
            str(sum(m.get('records', 0) for m in monthly)),
            _num(sum(m.get('total_fee', 0) for m in monthly)),
            _num(sum(m.get('prev_balance', 0) for m in monthly)),
            _num(sum(m.get('total_due', 0) for m in monthly)),
            _num(sum(m.get('total_collected', 0) for m in monthly)),
            _num(sum(m.get('total_balance', 0) for m in monthly)),
            f"{ys.get('collection_rate', 0)}%",
            str(sum(m.get('paid', 0) for m in monthly)),
            str(sum(m.get('partial', 0) for m in monthly)),
            str(sum(m.get('unpaid', 0) for m in monthly)),
        ])

        mcols = [68, 48, 68, 68, 68, 68, 68, 42, 38, 38, 38]
        mt = Table(rows, colWidths=mcols, repeatRows=1)
        mt.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1d4ed8')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 7),
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
            ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#d1d5db')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#f9fafb')]),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#eff6ff')),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('LINEABOVE', (0, -1), (-1, -1), 1.5, colors.HexColor('#1d4ed8')),
        ]))
        story.append(mt)
        story.append(Spacer(1, 14))

    # Class-wise Breakdown 
    class_wise = data.get('class_wise', [])
    if class_wise:
        story.append(Paragraph("Class-wise Annual Summary", ss['SectionHead']))
        cheader = ['Class', 'Students', 'Records', 'Total Due',
                   'Collected', 'Outstanding', 'Collection Rate']
        crows = [cheader]
        for cw in class_wise:
            crows.append([
                cw.get('class_name', ''),
                str(cw.get('student_count', 0)),
                str(cw.get('records', 0)),
                _num(cw.get('total_due', 0)),
                _num(cw.get('total_collected', 0)),
                _num(cw.get('total_balance', 0)),
                f"{cw.get('collection_rate', 0)}%",
            ])

        crows.append([
            'TOTAL',
            str(sum(c.get('student_count', 0) for c in class_wise)),
            str(sum(c.get('records', 0) for c in class_wise)),
            _num(sum(c.get('total_due', 0) for c in class_wise)),
            _num(sum(c.get('total_collected', 0) for c in class_wise)),
            _num(sum(c.get('total_balance', 0) for c in class_wise)),
            f"{ys.get('collection_rate', 0)}%",
        ])

        ccols = [100, 60, 60, 90, 90, 90, 85]
        ct = Table(crows, colWidths=ccols, repeatRows=1)
        ct.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1d4ed8')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
            ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#d1d5db')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#f9fafb')]),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#eff6ff')),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('LINEABOVE', (0, -1), (-1, -1), 1.5, colors.HexColor('#1d4ed8')),
        ]))
        story.append(ct)

    # Footer 
    story.append(Spacer(1, 20))
    sig_data = [['_________________', '', '_________________'],
                ['Accounts Officer', '', 'Principal']]
    sig_t = Table(sig_data, colWidths=[200, 300, 200])
    sig_t.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.gray),
    ]))
    story.append(sig_t)
    story.append(Spacer(1, 6))
    story.append(Paragraph("This is a computer-generated balance sheet.", ss['CenterSmall']))

    doc.build(story)
    buf.seek(0)
    return buf.read()

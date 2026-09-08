"""Excel workbooks for fee reporting.

The class collection sheet used to be a PDF (a dark-blue banded table that was
awkward to read and impossible to work with). It is a working document — staff
tick off payments against it and re-total — so it is a spreadsheet now: light
ruling, one accent, real numbers rather than pre-formatted "Rs 1,234" strings,
and print settings that fit a class onto one landscape page.
"""
import io
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

MONTHS = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]

SCHOOL_NAME = "The Creative School"

# Same palette as the app's "Registrar" theme, kept light enough to print and
# to photocopy without turning into a black band.
INK        = '20241F'
INK_SOFT   = '565B54'
ACCENT     = '1E5C48'
ACCENT_BG  = 'E6F0EB'
RULE       = 'D8D7D0'
DANGER     = 'A23B32'
DANGER_BG  = 'F9E9E6'
ZEBRA      = 'F7F7F4'

MONEY = '#,##0'

_thin = Side(style='thin', color=RULE)
BOX = Border(left=_thin, right=_thin, top=_thin, bottom=_thin)


def _num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _month_name(month):
    try:
        m = int(month)
    except (TypeError, ValueError):
        return str(month)
    return MONTHS[m] if 1 <= m <= 12 else str(month)


# Column layout: (header, width, kind). 'money' cells carry real numbers so the
# sheet stays summable; 'text' keeps admission numbers and phone numbers as
# strings so Excel doesn't strip a leading zero.
COLUMNS = [
    ('#',                4,  'index'),
    ('Receipt',         11,  'text'),
    ('Adm #',            9,  'text'),
    ('Student',         26,  'text'),
    ('Father / Guardian', 24, 'text'),
    ('Contact',         14,  'text'),
    ('Arrears',         11,  'money'),
    ('Fee',             10,  'money'),
    ('Charges',         10,  'money'),
    ('Total due',       12,  'money'),
    ('Paid',            11,  'money'),
    ('Balance',         12,  'money'),
    ('Status',          10,  'text'),
]

FIRST_MONEY_COL = 7   # 'Arrears'
BALANCE_COL     = 12
STATUS_COL      = 13


def _fmt_receipt(r):
    """20260001 -> 2026-0001."""
    r = str(r or '')
    if len(r) == 8 and r.isdigit():
        return f"{r[:4]}-{r[4:]}"
    return r


def _title_block(ws, class_name, month, year, records, summary):
    """School name, what the sheet is, and the figures it totals to."""
    last_col = get_column_letter(len(COLUMNS))

    ws.merge_cells(f'A1:{last_col}1')
    ws['A1'] = SCHOOL_NAME
    ws['A1'].font = Font(name='Calibri', size=16, bold=True, color=ACCENT)
    ws['A1'].alignment = Alignment(horizontal='left', vertical='center')
    ws.row_dimensions[1].height = 24

    ws.merge_cells(f'A2:{last_col}2')
    ws['A2'] = f"Fee Collection Sheet  ·  {class_name}  ·  {_month_name(month)} {year}"
    ws['A2'].font = Font(name='Calibri', size=11, color=INK)
    ws.row_dimensions[2].height = 17

    ws.merge_cells(f'A3:{last_col}3')
    ws['A3'] = f"Generated {date.today():%d %B %Y}"
    ws['A3'].font = Font(name='Calibri', size=9, color=INK_SOFT)

    due       = _num(summary.get('total_due'))
    collected = _num(summary.get('total_collected'))
    balance   = _num(summary.get('total_balance'))
    rate      = round(collected / due * 100, 1) if due else 0

    # A label/value strip: labels in the ruled tint, values beside them.
    stats = [
        ('Students',    len(records), None),
        ('Total due',   due,          MONEY),
        ('Collected',   collected,    MONEY),
        ('Outstanding', balance,      MONEY),
        ('Collected %', rate / 100,   '0.0%'),
    ]
    for i, (label, value, fmt) in enumerate(stats):
        lc = ws.cell(row=5, column=1 + i * 2, value=label)
        lc.font = Font(name='Calibri', size=9, bold=True, color=ACCENT)
        lc.fill = PatternFill('solid', fgColor=ACCENT_BG)
        lc.alignment = Alignment(horizontal='left', vertical='center', indent=1)
        lc.border = BOX

        vc = ws.cell(row=5, column=2 + i * 2, value=value)
        vc.font = Font(name='Calibri', size=10, bold=True, color=INK)
        vc.alignment = Alignment(horizontal='right', vertical='center', indent=1)
        vc.border = BOX
        if fmt:
            vc.number_format = fmt
    ws.row_dimensions[5].height = 18


def generate_class_collection_xlsx(class_name, month, year, records, summary):
    """One class's fee records for a month, as a workbook. Returns bytes."""
    wb = Workbook()
    ws = wb.active
    ws.title = 'Fee Collection'

    _title_block(ws, class_name, month, year, records, summary)

    header_row = 7
    for idx, (label, width, _kind) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = width
        c = ws.cell(row=header_row, column=idx, value=label)
        c.font = Font(name='Calibri', size=10, bold=True, color=ACCENT)
        c.fill = PatternFill('solid', fgColor=ACCENT_BG)
        c.alignment = Alignment(
            horizontal='right' if _kind == 'money' else 'left',
            vertical='center', wrap_text=False, indent=1)
        c.border = Border(bottom=Side(style='medium', color=ACCENT))
    ws.row_dimensions[header_row].height = 20

    row = header_row
    for i, r in enumerate(records, start=1):
        row = header_row + i
        s = r.get('student', {}) or {}
        status = str(r.get('status', '')).lower()
        owing = status in ('unpaid', 'partial')

        values = [
            i,
            _fmt_receipt(r.get('receipt_no')),
            str(s.get('admission_no', '') or ''),
            s.get('student_name', '') or '',
            s.get('f_g_name', '') or '',
            str(s.get('f_g_contact', '') or ''),
            _num(r.get('previous_balance')),
            _num(r.get('current_fee')),
            _num(r.get('misc_charges')),
            _num(r.get('total_amount')),
            _num(r.get('amount_paid')),
            _num(r.get('balance')),
            status.title(),
        ]

        for col, value in enumerate(values, start=1):
            c = ws.cell(row=row, column=col, value=value)
            c.font = Font(name='Calibri', size=10, color=INK)
            c.border = BOX
            if FIRST_MONEY_COL <= col <= BALANCE_COL:
                c.number_format = MONEY
                c.alignment = Alignment(horizontal='right', indent=1)
            elif col == 1:
                c.alignment = Alignment(horizontal='center')
            else:
                c.alignment = Alignment(horizontal='left', indent=1)
            if i % 2 == 0:
                c.fill = PatternFill('solid', fgColor=ZEBRA)

        # An unpaid row is flagged on the two cells that carry the meaning,
        # rather than by drowning the whole row in red.
        if owing:
            for col in (BALANCE_COL, STATUS_COL):
                c = ws.cell(row=row, column=col)
                c.font = Font(name='Calibri', size=10, bold=True, color=DANGER)
                c.fill = PatternFill('solid', fgColor=DANGER_BG)

    # Totals — live formulas, so the sheet re-totals if a figure is edited.
    total_row = row + 1
    ws.cell(row=total_row, column=1)
    tc = ws.cell(row=total_row, column=2, value='TOTAL')
    ws.merge_cells(start_row=total_row, start_column=2, end_row=total_row, end_column=6)
    tc.font = Font(name='Calibri', size=10, bold=True, color=ACCENT)
    tc.alignment = Alignment(horizontal='right', indent=1)

    first_data, last_data = header_row + 1, row
    for col in range(1, len(COLUMNS) + 1):
        c = ws.cell(row=total_row, column=col)
        c.border = Border(top=Side(style='medium', color=ACCENT))
        c.fill = PatternFill('solid', fgColor=ACCENT_BG)
        if col >= FIRST_MONEY_COL and col <= BALANCE_COL and records:
            letter = get_column_letter(col)
            c.value = f'=SUM({letter}{first_data}:{letter}{last_data})'
            c.number_format = MONEY
            c.alignment = Alignment(horizontal='right', indent=1)
            c.font = Font(name='Calibri', size=10, bold=True, color=ACCENT)
    ws.row_dimensions[total_row].height = 19

    # Header stays visible while scrolling a long class, and Excel gets a
    # filter over the data so staff can pull out just the unpaid rows.
    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)
    if records:
        ws.auto_filter.ref = (
            f'A{header_row}:{get_column_letter(len(COLUMNS))}{last_data}')

    ws.page_setup.orientation = 'landscape'
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f'{header_row}:{header_row}'
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = ws.page_margins.right = 0.3
    ws.page_margins.top = ws.page_margins.bottom = 0.4

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()

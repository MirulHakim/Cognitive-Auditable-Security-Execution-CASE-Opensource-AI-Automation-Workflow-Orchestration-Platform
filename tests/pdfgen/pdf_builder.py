from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

def generate_pdf_safely(data) -> str:
    """
    Compiles a PDF file safely within the current script directory 
    using ReportLab based on structured Pydantic schema data.
    """
    # 🛡️ Security Check: Ensure file is written ONLY in current directory
    script_dir = Path(__file__).parent.resolve()
    clean_filename = Path(data.filename).name
    if not clean_filename.endswith(".pdf"):
        clean_filename += ".pdf"
        
    target_path = (script_dir / clean_filename).resolve()

    if target_path.parent != script_dir:
        raise PermissionError("Security Violation: Attempted directory traversal outside folder.")

    # 🎨 Set up Styles
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontSize=22,
        leading=26,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=6
    )
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=18
    )
    heading_style = ParagraphStyle(
        'SectionHeading',
        parent=styles['Heading2'],
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=12,
        spaceAfter=6
    )
    body_style = ParagraphStyle(
        'BodyText',
        parent=styles['BodyText'],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#334155"),
        spaceAfter=10
    )

    # 📄 Build PDF Elements
    story = []

    # Title & Subtitle
    story.append(Paragraph(data.document_title, title_style))
    if data.subtitle:
        story.append(Paragraph(data.subtitle, subtitle_style))

    # Text Sections
    for section in data.sections:
        story.append(Paragraph(section.heading, heading_style))
        story.append(Paragraph(section.body, body_style))
        story.append(Spacer(1, 6))

    # Table (if present)
    if data.table and data.table.headers:
        table_content = [data.table.headers] + data.table.rows
        t = Table(table_content, hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#2563eb")),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor("#f8fafc")),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('PADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(Spacer(1, 10))
        story.append(t)

    # Render Document
    doc = SimpleDocTemplate(
        str(target_path),
        pagesize=letter,
        rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36
    )
    doc.build(story)

    return str(target_path)
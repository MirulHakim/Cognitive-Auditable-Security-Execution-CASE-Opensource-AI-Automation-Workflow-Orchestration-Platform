from pydantic import BaseModel, Field
from typing import List, Optional

class PDFSection(BaseModel):
    heading: str = Field(description="Section heading/title")
    body: str = Field(description="Paragraph text for this section")

class PDFTableData(BaseModel):
    headers: List[str] = Field(description="Column header titles")
    rows: List[List[str]] = Field(description="2D array of table row data")

class PDFDocumentSchema(BaseModel):
    filename: str = Field(description="Filename ending in .pdf (e.g. 'q2_summary.pdf')")
    document_title: str = Field(description="Main document title at top of PDF")
    subtitle: Optional[str] = Field(description="Subtitle or date string")
    sections: List[PDFSection] = Field(description="List of text sections")
    table: Optional[PDFTableData] = Field(default=None, description="Optional structured data table")
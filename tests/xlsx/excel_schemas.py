from pydantic import BaseModel, Field
from typing import List, Optional

class ExcelSheetData(BaseModel):
    sheet_name: str = Field(description="Name of the worksheet tab (e.g., 'Q3 Revenue', 'Inventory')")
    headers: List[str] = Field(description="List of column header titles")
    rows: List[List[str]] = Field(description="2D array of rows containing string or numeric data")

class ExcelDocumentSchema(BaseModel):
    filename: str = Field(description="Filename ending in .xlsx (e.g., 'financial_report.xlsx')")
    title: str = Field(description="Title header printed inside the spreadsheet")
    sheets: List[ExcelSheetData] = Field(description="List of worksheet tabs to include in the workbook")
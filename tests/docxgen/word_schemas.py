from pydantic import BaseModel, Field
from typing import List, Optional

class WordSection(BaseModel):
    heading: str = Field(description="Section heading or subheading")
    paragraphs: List[str] = Field(description="List of paragraph text blocks under this section")
    bullet_points: Optional[List[str]] = Field(default=None, description="Optional bulleted items for this section")

class WordDocumentSchema(BaseModel):
    filename: str = Field(description="Filename ending in .docx (e.g., 'project_proposal.docx')")
    document_title: str = Field(description="Main title of the Word document")
    author_or_subtitle: Optional[str] = Field(description="Subtitle, author name, or date string")
    sections: List[WordSection] = Field(description="Logical content sections of the document")
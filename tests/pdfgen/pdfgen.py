import os
import sys
from pathlib import Path

# Add current folder to sys.path so it can locate pdf_builder and schemas
CURRENT_DIR = Path(__file__).parent.resolve()
if str(CURRENT_DIR) not in sys.path:
    sys.path.append(str(CURRENT_DIR))

from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from tests.pdfgen.pdf_builder import generate_pdf_safely
from tests.pdfgen.schemas import PDFDocumentSchema

# =====================================================================
# 1. Initialize Ollama LLM Connection
# =====================================================================
# Default fallback set to 127.0.0.1 (IPv4 loopback)
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://100.99.95.105:11434")
MODEL_NAME = os.getenv("OLLAMA_MODEL", "qwen3.5:9b")

print(f"🔄 Connecting to ChatOllama ({MODEL_NAME}) at {OLLAMA_HOST}...")

llm = ChatOllama(
    model=MODEL_NAME,
    base_url=OLLAMA_HOST,
    temperature=0.1
)

# Enforce Pydantic schema output
structured_llm = llm.with_structured_output(PDFDocumentSchema)

# =====================================================================
# 2. Define System Prompt for Document Design
# =====================================================================
system_prompt = (
    "You are an expert Executive Document Designer. "
    "Your job is to convert user requests into clear, well-structured PDF document data. "
    "REQUIREMENTS:\n"
    "1. Always choose a clean filename ending in '.pdf'.\n"
    "2. Provide a strong document title and helpful subtitle.\n"
    "3. Structure text into logical sections with descriptive headings and body paragraphs.\n"
    "4. If the prompt contains numbers, metrics, or comparison data, include a formatted table with column headers."
)

prompt_template = ChatPromptTemplate.from_messages([
    ("system", system_prompt),
    ("human", "{user_request}")
])

chain = prompt_template | structured_llm


# =====================================================================
# 3. Interactive CLI Loop
# =====================================================================
def main():
    print("\n📄 AI PDF Generator Tool Ready!")
    print("Type what you want in the PDF (e.g. 'Create a Q3 sales report comparing Product A and Product B').")
    print("Type 'exit' or 'quit' to stop.\n")

    while True:
        try:
            user_input = input("User Request > ").strip()
            if not user_input:
                continue
            if user_input.lower() in ["exit", "quit"]:
                print("Goodbye!")
                break

            print("\n🧠 AI generating document layout & content...")
            
            # 1. Ask AI to draft structured schema from prompt
            pdf_data: PDFDocumentSchema = chain.invoke({"user_request": user_input})
            
            print(f"  ├─ Document Title: {pdf_data.document_title}")
            print(f"  ├─ Target Filename: {pdf_data.filename}")
            print("🎨 Compiling PDF with ReportLab...")

            # 2. Build the physical PDF file safely
            saved_pdf_path = generate_pdf_safely(pdf_data)

            print(f"✅ Success! PDF saved at: {saved_pdf_path}\n")

        except Exception as e:
            print(f"❌ Error: {e}\n")


if __name__ == "__main__":
    main()
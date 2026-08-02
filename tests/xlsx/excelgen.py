import os
import sys
from pathlib import Path

# Add current directory to path
CURRENT_DIR = Path(__file__).parent.resolve()
if str(CURRENT_DIR) not in sys.path:
    sys.path.append(str(CURRENT_DIR))

from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from excel_builder import generate_excel_safely
from excel_schemas import ExcelDocumentSchema

# =====================================================================
# 1. Initialize Ollama LLM Connection
# =====================================================================
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://100.99.95.105:11434")
MODEL_NAME = os.getenv("OLLAMA_MODEL", "qwen3.5:9b")

print(f"🔄 Connecting to ChatOllama ({MODEL_NAME}) at {OLLAMA_HOST}...")

llm = ChatOllama(
    model=MODEL_NAME,
    base_url=OLLAMA_HOST,
    temperature=0.1
)

structured_llm = llm.with_structured_output(ExcelDocumentSchema)

# =====================================================================
# 2. Define System Prompt for Spreadsheet Generation
# =====================================================================
system_prompt = (
    "You are an expert Data Analyst & Spreadsheet Specialist. "
    "Your job is to convert user requests into clean, organized Excel spreadsheet datasets. "
    "REQUIREMENTS:\n"
    "1. Pick a clear filename ending in '.xlsx'.\n"
    "2. Provide a descriptive main document title.\n"
    "3. Structure tables with clear column headers and accurate row values.\n"
    "4. Use separate sheets if the request covers distinct categories or time periods."
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
    print("\n📊 AI Excel (.xlsx) Generator Tool Ready!")
    print("Type what data you want (e.g., 'Generate an inventory tracking sheet with 5 products, stock levels, and prices').")
    print("Type 'exit' or 'quit' to stop.\n")

    while True:
        try:
            user_input = input("User Request > ").strip()
            if not user_input:
                continue
            if user_input.lower() in ["exit", "quit"]:
                print("Goodbye!")
                break

            print("\n🧠 AI generating structured spreadsheet layout...")
            excel_data: ExcelDocumentSchema = chain.invoke({"user_request": user_input})

            print(f"  ├─ Title: {excel_data.title}")
            print(f"  ├─ Target Filename: {excel_data.filename}")
            print(f"  ├─ Sheets Generated: {[s.sheet_name for s in excel_data.sheets]}")
            
            print("🎨 Compiling .xlsx with openpyxl...")
            saved_path = generate_excel_safely(excel_data)

            print(f"✅ Success! Excel file saved at: {saved_path}\n")

        except Exception as e:
            print(f"❌ Error: {e}\n")


if __name__ == "__main__":
    main()
import os
import sys
from pathlib import Path

# Add current directory to path
CURRENT_DIR = Path(__file__).parent.resolve()
if str(CURRENT_DIR) not in sys.path:
    sys.path.append(str(CURRENT_DIR))

from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from word_builder import generate_word_safely
from word_schemas import WordDocumentSchema

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

structured_llm = llm.with_structured_output(WordDocumentSchema)

# =====================================================================
# 2. Define System Prompt for Word Generation
# =====================================================================
system_prompt = (
    "You are an expert Technical Writer and Document Architect. "
    "Your job is to convert user requests into clean, well-structured Word document data (.docx). "
    "REQUIREMENTS:\n"
    "1. Pick a clear filename ending in '.docx'.\n"
    "2. Provide a professional document title and subtitle.\n"
    "3. Divide content into logical sections with clear headings, detailed paragraphs, and helpful bullet points where appropriate."
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
    print("\n📝 AI Word (.docx) Generator Tool Ready!")
    print("Type what you want written (e.g., 'Write a project charter for an automated security orchestration pipeline').")
    print("Type 'exit' or 'quit' to stop.\n")

    while True:
        try:
            user_input = input("User Request > ").strip()
            if not user_input:
                continue
            if user_input.lower() in ["exit", "quit"]:
                print("Goodbye!")
                break

            print("\n🧠 AI drafting document layout & content...")
            word_data: WordDocumentSchema = chain.invoke({"user_request": user_input})

            print(f"  ├─ Title: {word_data.document_title}")
            print(f"  ├─ Target Filename: {word_data.filename}")
            print(f"  ├─ Sections Created: {len(word_data.sections)}")
            
            print("🎨 Compiling .docx with python-docx...")
            saved_path = generate_word_safely(word_data)

            print(f"✅ Success! Word document saved at: {saved_path}\n")

        except Exception as e:
            print(f"❌ Error: {e}\n")


if __name__ == "__main__":
    main()
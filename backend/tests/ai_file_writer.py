import os
from pathlib import Path
from pydantic import BaseModel, Field
from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate

# =====================================================================
# 1. Define Structured Output Schema
# =====================================================================
class CodeFileResponse(BaseModel):
    filename: str = Field(
        description="The name of the file with extension, e.g., 'utils.py' or 'script.js'. Must NOT contain directory paths."
    )
    content: str = Field(
        description="The complete, raw code/text content to be written into the file. Do NOT include markdown code blocks (```)."
    )

# =====================================================================
# 2. Setup LLM & System Prompt
# =====================================================================
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://100.99.95.105:11434")
MODEL_NAME = "qwen3.5:9b"  # Or your loaded Ollama model

llm = ChatOllama(
    model=MODEL_NAME,
    base_url=OLLAMA_HOST,
    temperature=0.1
)

# Enforce structured Pydantic output
structured_llm = llm.with_structured_output(CodeFileResponse)

system_prompt = (
    "You are an elite, concise Senior Developer tool. "
    "Your sole duty is to generate functional, production-ready code files based on user requests. "
    "CONSTRAINTS:\n"
    "1. Never output conversational responses, pleasantries, explanations, or summaries.\n"
    "2. Provide only the valid file name and raw file content.\n"
    "3. Keep code modular, clean, and bug-free."
)

prompt_template = ChatPromptTemplate.from_messages([
    ("system", system_prompt),
    ("human", "{user_input}")
])

chain = prompt_template | structured_llm

# =====================================================================
# 3. Security Helper (Strict Local Folder Locking)
# =====================================================================
def write_file_safely(filename: str, content: str):
    """
    Ensures the file can ONLY be written inside the directory 
    where this script lives, preventing directory traversal attacks.
    """
    script_dir = Path(__file__).parent.resolve()
    
    # Strip any directory separators from filename (e.g. "../../etc/passwd" -> "passwd")
    clean_filename = Path(filename).name
    
    target_path = (script_dir / clean_filename).resolve()

    # Security check: Ensure target path remains inside script directory
    if target_path.parent != script_dir:
        raise SecurityError(f"Security Violation: Attempted writing outside root directory to '{target_path}'")

    with open(target_path, "w", encoding="utf-8") as f:
        f.write(content)

    return target_path

# =====================================================================
# 4. Interactive Command Line Loop
# =====================================================================
def main():
    print("🤖 AI File Writer Tool Initialized.")
    print("Type your request below (or type 'exit' to quit).\n")

    while True:
        try:
            user_input = input("You > ").strip()
            if not user_input:
                continue
            if user_input.lower() in ["exit", "quit"]:
                print("Goodbye!")
                break

            print("🧠 AI generating code...")
            result: CodeFileResponse = chain.invoke({"user_input": user_input})

            # Save file with security checks
            saved_path = write_file_safely(result.filename, result.content)
            
            print(f"✅ Success! Generated and saved: {saved_path.name}")
            print(f"📁 Path: {saved_path}\n")

        except Exception as e:
            print(f"❌ Error: {e}\n")

if __name__ == "__main__":
    main()
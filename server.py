import os
import uuid
from typing import TypedDict, Literal, Optional
from pydantic import BaseModel, Field

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.memory import MemorySaver

# =====================================================================
# 1. Initialize FastAPI Application
# =====================================================================
app = FastAPI(
    title="CASE AI Orchestration Platform API",
    description="API for managing Human-in-the-Loop workflows with Ollama and LangGraph",
    version="1.0.0"
)

# Allow React Frontend (Vite) to communicate with FastAPI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust to "http://localhost:5173" for strict production security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =====================================================================
# 2. Configure Qwen 3.5 (9B) and LangGraph Engine
# =====================================================================
OLLAMA_BASE_URL = os.getenv("OLLAMA_HOST", "http://100.99.95.105:11434")
MODEL_NAME = "qwen3.5:9b"

llm = ChatOllama(
    model=MODEL_NAME,
    base_url=OLLAMA_BASE_URL,
    temperature=0.1
)

class IntentAnalysis(BaseModel):
    document_type: Literal["pdf", "excel", "word", "text_answer"]
    summary: str
    data_sources_needed: list[str]

class WorkflowState(TypedDict):
    sender: str
    user_request: str
    doc_type: str
    plan_summary: str
    fetched_data: str
    generated_doc: str

def analyze_and_plan_node(state: WorkflowState):
    structured_llm = llm.with_structured_output(IntentAnalysis)
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an AI Workflow Planner. Analyze the user request and determine the exact document format needed, a brief summary of the task, and data sources required."),
        ("human", "Sender: {sender}\nRequest: {user_request}")
    ])
    chain = prompt | structured_llm
    result: IntentAnalysis = chain.invoke({
        "sender": state["sender"],
        "user_request": state["user_request"]
    })
    return {"doc_type": result.document_type, "plan_summary": result.summary}

def gate_one_approval_node(state: WorkflowState):
    user_decision = interrupt({
        "gate": 1,
        "action": "AUTHORIZE_DATA_FETCH",
        "sender": state["sender"],
        "plan": state["plan_summary"],
        "doc_type": state["doc_type"]
    })
    if user_decision.get("approved"):
        return {"fetched_data": "Quarterly Revenue: RM120,000 | Profit Margin: 24%"}
    raise PermissionError("Job rejected at Gate 1.")

def document_generator_node(state: WorkflowState):
    doc_type = state["doc_type"]
    data = state["fetched_data"]
    doc = f"[{doc_type.upper()} Document Content]: {data}"
    return {"generated_doc": doc}

def gate_two_approval_node(state: WorkflowState):
    user_decision = interrupt({
        "gate": 2,
        "action": "AUTHORIZE_EMAIL_TELEGRAM_SEND",
        "recipient": state["sender"],
        "output_preview": state["generated_doc"]
    })
    if user_decision.get("approved"):
        return {}
    raise PermissionError("Job rejected at Gate 2.")

builder = StateGraph(WorkflowState)
builder.add_node("planner", analyze_and_plan_node)
builder.add_node("gate_1", gate_one_approval_node)
builder.add_node("doc_builder", document_generator_node)
builder.add_node("gate_2", gate_two_approval_node)

builder.add_edge(START, "planner")
builder.add_edge("planner", "gate_1")
builder.add_edge("gate_1", "doc_builder")
builder.add_edge("doc_builder", "gate_2")
builder.add_edge("gate_2", END)

# In-Memory Checkpointer (Use SqliteSaver for production database persistence)
memory = MemorySaver()
graph_app = builder.compile(checkpointer=memory)


# =====================================================================
# 3. Request / Response Pydantic Schemas for API
# =====================================================================
class CreateJobRequest(BaseModel):
    sender: str = Field(..., example="boss@company.com")
    user_request: str = Field(..., example="Send me a PDF summary of Q2 revenue")

class ApprovalRequest(BaseModel):
    approved: bool = Field(..., example=True)


# =====================================================================
# 4. FastAPI Endpoints
# =====================================================================

@app.post("/api/jobs/create", status_code=201)
def create_job(request: CreateJobRequest):
    """
    Triggered by Telegram/Gmail Ingress webhook.
    Starts the workflow and runs until it hits Gate 1.
    """
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    initial_state = {
        "sender": request.sender,
        "user_request": request.user_request
    }

    # Run workflow until first interrupt (Gate 1)
    for _ in graph_app.stream(initial_state, config=config):
        pass

    # Fetch paused state info
    current_state = graph_app.get_state(config)
    
    return {
        "status": "PAUSED_AT_GATE_1",
        "thread_id": thread_id,
        "review_data": current_state.tasks[0].interrupts[0].value
    }


@app.get("/api/jobs/{thread_id}")
def get_job_status(thread_id: str):
    """
    Called by Dashboard to fetch details and pending review data for a specific job.
    """
    config = {"configurable": {"thread_id": thread_id}}
    state = graph_app.get_state(config)

    if not state.values:
        raise HTTPException(status_code=404, detail="Job thread not found.")

    is_paused = len(state.next) > 0
    interrupt_data = state.tasks[0].interrupts[0].value if is_paused and state.tasks[0].interrupts else None

    return {
        "thread_id": thread_id,
        "is_paused": is_paused,
        "next_node": state.next,
        "current_values": state.values,
        "pending_approval": interrupt_data
    }


@app.post("/api/jobs/{thread_id}/approve")
def respond_to_approval(thread_id: str, payload: ApprovalRequest):
    """
    Called by Dashboard when the user clicks 'Approve' or 'Reject'.
    Resumes the paused thread.
    """
    config = {"configurable": {"thread_id": thread_id}}
    state = graph_app.get_state(config)

    if not state.next:
        raise HTTPException(status_code=400, detail="Workflow has already completed or cancelled.")

    # Resume graph execution with approval decision
    try:
        for _ in graph_app.stream(Command(resume={"approved": payload.approved}), config=config):
            pass
    except PermissionError as e:
        return {"status": "REJECTED", "message": str(e)}

    # Check updated state after resuming
    new_state = graph_app.get_state(config)

    if len(new_state.next) > 0:
        return {
            "status": "PAUSED_AT_GATE_2",
            "thread_id": thread_id,
            "review_data": new_state.tasks[0].interrupts[0].value
        }
    else:
        return {
            "status": "COMPLETED",
            "thread_id": thread_id,
            "final_output": new_state.values.get("generated_doc")
        }


# =====================================================================
# 5. Application Entrypoint
# =====================================================================
if __name__ == "__main__":
    import uvicorn
    # Starts local dev server with hot-reloading enabled
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
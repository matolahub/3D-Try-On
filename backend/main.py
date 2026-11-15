from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from tryon.extract.pipeline import extract_from_url
from tryon.fetcher import FetchError
from tryon.schemas import ExtractResult

app = FastAPI(title="3D Try-On API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET", "POST"], allow_headers=["*"])


@app.get("/")
def root():
    return {"message": "Backend is running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


class ExtractRequest(BaseModel):
    url: str


_STATUS = {"invalid_url": 400, "forbidden_host": 400, "dns_error": 400, "robots_disallowed": 403, "blocked_by_site": 422,
           "http_error": 502, "network_error": 502, "not_html": 422, "too_many_redirects": 502}


@app.post("/api/extract", response_model=ExtractResult)
def extract(req: ExtractRequest):
    """URL prodotto -> dati prodotto, categoria, size chart. Nessun dato inventato, nessun bypass anti-bot."""
    try:
        return extract_from_url(req.url)
    except FetchError as e:
        raise HTTPException(status_code=_STATUS.get(e.code, 502), detail={"code": e.code, "message": e.message})

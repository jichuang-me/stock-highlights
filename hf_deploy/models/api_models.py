from __future__ import annotations
from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field

class SearchStock(BaseModel):
    code: str
    name: str
    industry: Optional[str] = None
    price: float = 0.0
    pct: float = 0.0

class Evidence(BaseModel):
    title: str
    published_at: str
    source: str
    url: str
    time: Optional[str] = None

class HighlightItem(BaseModel):
    id: str
    side: Literal["risk", "positive"]
    label: str
    score: int
    category: str
    why: str
    interpretation: str
    game_view: str
    evidence: List[Evidence] = Field(default_factory=list)

class StockSummary(BaseModel):
    riskCount: int
    positiveCount: int
    sentiment: str = "neutral"

class HighlightsResponse(BaseModel):
    stock: Dict[str, str]
    summary: StockSummary
    marketImpression: str
    price: float
    pctChange: float
    priceHistory: List[Dict[str, Any]] = Field(default_factory=list)
    highlights: List[HighlightItem] = Field(default_factory=list)
    liveNews: List[Dict[str, Any]] = Field(default_factory=list)
    radar: List[Dict[str, Any]] = Field(default_factory=list)

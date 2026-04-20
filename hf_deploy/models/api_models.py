from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class SearchStock(BaseModel):
    code: str
    name: str
    industry: Optional[str] = None
    price: float = 0.0
    pct: float = 0.0


class StockInfo(BaseModel):
    code: str
    name: str
    industry: Optional[str] = None


class Evidence(BaseModel):
    source: str
    title: str
    published_at: str
    url: str


class HighlightItem(BaseModel):
    id: str
    side: Literal["risk", "positive"]
    label: str
    score: int = Field(ge=0, le=100)
    category: str
    why: str
    interpretation: str
    game_view: str
    evidence: List[Evidence] = Field(default_factory=list)


class StockSummary(BaseModel):
    riskCount: int
    positiveCount: int
    sentiment: Literal["positive", "negative", "neutral"]


class NewsItem(BaseModel):
    title: str
    time: str
    url: str
    source: str
    tag: Optional[str] = None


class RadarPoint(BaseModel):
    k: str
    v: float = Field(ge=0, le=100)


class HighlightsResponse(BaseModel):
    stock: StockInfo
    summary: StockSummary
    marketImpression: str
    price: float
    pctChange: float
    highlights: List[HighlightItem] = Field(default_factory=list)
    liveNews: List[NewsItem] = Field(default_factory=list)
    radar: List[RadarPoint] = Field(default_factory=list)

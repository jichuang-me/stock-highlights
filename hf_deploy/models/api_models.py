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


class StockOutlook(BaseModel):
    consensus: str = Field(..., description="分析师共识")
    shortTerm: str = Field(..., description="短期触发剂")
    valuation: str = Field(..., description="估值变化预期")


class MarketImpression(BaseModel):
    summary: str = Field(..., description="简要总结")
    positioning: str = Field(..., description="市场定位")
    attention: str = Field(..., description="投资者关注度")


class HighlightsResponse(BaseModel):
    stock: StockInfo
    summary: StockSummary
    marketImpression: MarketImpression
    headline: str = Field(..., description="一句话核心结论")
    price: float
    pctChange: float
    outlook: StockOutlook
    highlights: List[HighlightItem] = Field(default_factory=list)
    liveNews: List[NewsItem] = Field(default_factory=list)
    radar: List[RadarPoint] = Field(default_factory=list)

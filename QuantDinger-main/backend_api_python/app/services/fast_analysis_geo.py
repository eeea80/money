import re
from typing import List, Optional, Tuple


_GEO_SEVERE_PATTERNS: List[re.Pattern] = [
    re.compile(r"\b(?:war|wars|warfare|wartime)\b", re.I),
    re.compile(r"\b(?:invasion|invaded|invading|invade)\b", re.I),
    re.compile(r"\b(?:airstrike|air\s*strikes?|missile\s+strike|drone\s+strike)\b", re.I),
    re.compile(r"\b(?:military\s+attack|armed\s+attack|troops?\s+(?:fire|attack|invade))\b", re.I),
    re.compile(r"\b(?:declare[sd]?\s+war|state\s+of\s+war|act\s+of\s+war)\b", re.I),
    re.compile(r"\b(?:martial\s+law|military\s+coup|coup\s+d['\u2019]?etat)\b", re.I),
    re.compile(r"\b(?:terror(?:ist)?\s+attack|mass\s+shooting\s+at)\b", re.I),
]

_GEO_MODERATE_PATTERNS: List[re.Pattern] = [
    re.compile(r"\bgeopolitical\b", re.I),
    re.compile(r"\b(?:armed|military)\s+conflict\b", re.I),
    re.compile(r"\b(?:international\s+)?sanctions?\s+(?:on|against|targeting|hit)\b", re.I),
    re.compile(r"\b(?:naval\s+blockade|border\s+clash|ceasefire\s+(?:broken|violated))\b", re.I),
    re.compile(r"\b(?:evacuat\w+\s+(?:the\s+)?embassy|embassy\s+evacuation)\b", re.I),
    re.compile(r"\b(?:nuclear\s+(?:threat|strike|weapon)|nuclear\s+war)\b", re.I),
]

_GEO_CONTEXT_MODERATE: List[re.Pattern] = [
    re.compile(r"\b(?:geopolitical|diplomatic|border)\s+(?:crisis|tension|standoff)\b", re.I),
    re.compile(r"\b(?:tensions?\s+(?:rise|escalat|flare|mount)\s+(?:with|between))\b", re.I),
    re.compile(r"\b(?:middle\s+east|south\s+china\s+sea|taiwan\s+strait)\s+(?:crisis|tension|conflict)\b", re.I),
]

_GEO_ZH_SEVERE = (
    "宣战",
    "战争爆发",
    "全面战争",
    "武装冲突",
    "军事打击",
    "军事入侵",
    "空袭",
    "导弹袭击",
    "开战",
    "交火",
    "战火",
)
_GEO_ZH_MODERATE = (
    "地缘政治危机",
    "国际制裁升级",
    "断交",
    "撤侨",
    "军事对峙",
    "地区冲突升级",
)

_GEO_REGION_CONFLICT: List[re.Pattern] = [
    re.compile(
        r"\b(?:russia|ukraine|iran|israel|gaza|hamas|taiwan|north\s+korea|dprk|"
        r"syria|yemen|lebanon|nato)\b.{0,40}\b(?:invade|attack|strike|war|conflict|sanction)\b",
        re.I,
    ),
    re.compile(
        r"\b(?:invade|attack|strike|war|conflict|sanction)\b.{0,40}\b(?:russia|ukraine|iran|israel|"
        r"gaza|hamas|taiwan|north\s+korea|dprk|syria|nato)\b",
        re.I,
    ),
]

_GEO_MAJOR_NEWS_SEVERE = [
    re.compile(r"\b(?:war|wars|warfare)\b", re.I),
    re.compile(r"\b(?:invasion|invaded|military\s+attack|airstrike)\b", re.I),
    re.compile(r"\b(?:armed\s+conflict|military\s+conflict)\b", re.I),
]


def geopolitical_match_level(combined_text: str) -> Tuple[str, Optional[str]]:
    """Return a geopolitical risk level and a compact reason tag."""
    if not combined_text or len(combined_text.strip()) < 4:
        return "none", None
    lowered = combined_text.lower()
    for pattern in _GEO_SEVERE_PATTERNS:
        if pattern.search(lowered):
            return "severe", pattern.pattern[:48]
    for keyword in _GEO_ZH_SEVERE:
        if keyword in combined_text:
            return "severe", keyword
    for pattern in _GEO_REGION_CONFLICT:
        if pattern.search(lowered):
            return "severe", "region+conflict"
    for pattern in _GEO_MODERATE_PATTERNS:
        if pattern.search(lowered):
            return "moderate", pattern.pattern[:48]
    for pattern in _GEO_CONTEXT_MODERATE:
        if pattern.search(lowered):
            return "moderate", pattern.pattern[:48]
    for keyword in _GEO_ZH_MODERATE:
        if keyword in combined_text:
            return "moderate", keyword
    return "none", None


def geopolitical_sentiment_penalty_delta(level: str) -> int:
    """Map geopolitical risk severity to the sentiment score adjustment."""
    if level == "severe":
        return -42
    if level == "moderate":
        return -18
    return 0


def is_major_geopolitical_news_text(combined_text: str) -> bool:
    """Detect only clear war/conflict events for major-news handling."""
    if not combined_text:
        return False
    lowered = combined_text.lower()
    for pattern in _GEO_MAJOR_NEWS_SEVERE:
        if pattern.search(lowered):
            return True
    for keyword in _GEO_ZH_SEVERE:
        if keyword in combined_text:
            return True
    return any(pattern.search(lowered) for pattern in _GEO_REGION_CONFLICT)

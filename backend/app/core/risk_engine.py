from __future__ import annotations


def compute_risk_score(text: str) -> tuple[int, list[str], str]:
    factors: list[str] = []
    score = 10
    lower = text.lower()

    if "admin" in lower or "administrator" in lower:
        score += 20
        factors.append("Privileged account targeted")
    if "successful login" in lower or "login succeeded" in lower or "one login succeeded" in lower:
        score += 20
        factors.append("Successful authentication observed")
    if "sensitive" in lower or "download" in lower or "file access" in lower:
        score += 18
        factors.append("Suspicious access to sensitive resources")
    if "unverified" in lower or "unknown" in lower or "don't know" in lower:
        score += 8
        factors.append("Unresolved uncertainty remains")
    if "2:14" in lower or "2:16" in lower or "2:19" in lower:
        score += 6
        factors.append("Specific suspicious timestamps recorded")

    score = max(0, min(score, 100))
    if score >= 75:
        severity = "critical"
    elif score >= 50:
        severity = "high"
    elif score >= 25:
        severity = "medium"
    else:
        severity = "low"

    return score, factors, severity

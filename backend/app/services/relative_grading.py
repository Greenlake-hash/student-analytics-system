"""
Relative grading statistics engine: mean/median/mode/stdev, z-scores,
rank, and percentile for a cohort of raw course scores.

Per the migration plan's "Relative Grading Engine" and "Relative Grade
Formula" sections:

    z = (student_score - class_mean) / standard_deviation

    Default boundaries (configurable per course via RelativeGradingRule):
        AA: z >= 1.5        AB: 1.0 <= z < 1.5      BB: 0.5 <= z < 1.0
        BC: 0   <= z < 0.5  CC: -0.5 <= z < 0       CD: -1.0 <= z < -0.5
        DD: -1.5 <= z < -1.0   F: z < -1.5

Like app/services/grading.py, this is deliberately pure: plain
dataclasses/lists/floats in and out, no DB or FastAPI imports, so it's
testable in complete isolation and reusable from anywhere (the freeze
trigger, an analytics endpoint, a one-off recompute script) without
dragging in request/session state.

Explicit statistical choices worth being visible about, not buried:

POPULATION vs. SAMPLE STANDARD DEVIATION: this engine uses POPULATION
stdev (divide by N, not N-1). The class being graded IS the entire
population for that course/trimester -- it is not a sample drawn to
estimate a larger population's parameter -- so population stdev is the
statistically correct choice here, and it's also the convention used by
most institutional relative-grading systems. If you ever need sample
stdev instead, change ONLY `_population_stdev` -- every other function
in this module is written in terms of "the stdev that was passed in,"
not a hardcoded formula, specifically so this is a one-line change.

ZERO-VARIANCE COHORTS: if every student scored identically, stdev is 0
and z = (score - mean) / 0 is undefined. Rather than raise or silently
return 0 (which would incorrectly imply "exactly average" for everyone,
hiding the fact that no real comparison was possible), this engine
returns z=0.0 for every student AND flags the result, so callers can
choose to grade everyone at the BC boundary, fall back to absolute
grading, or surface a warning -- whichever the institution prefers in
that genuinely degenerate case (small synthetic cohorts where multiple
students enter identical scores can trigger this).

TIE HANDLING IN RANK: standard competition ranking ("1224"). Two
students tied for 2nd place are both ranked 2; the next student is
ranked 4, not 3 -- there is no rank 3, mirroring how ties are commonly
handled in real academic ranking systems (nobody is shorted a rank
position by someone else's tie).
"""
import math
import statistics
from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class StudentScore:
    student_id: str
    raw_score: float


@dataclass(frozen=True)
class CohortStatistics:
    mean: float
    median: float
    mode: float | None  # None if no value repeats (every score is unique) -- a real, common case, not an error
    stdev: float
    count: int
    is_zero_variance: bool  # see module docstring


@dataclass(frozen=True)
class StudentResultOutput:
    student_id: str
    raw_score: float
    z_score: float
    relative_grade: str
    rank: int
    percentile: float


# Boundaries ordered highest-to-lowest; the first one a z-score meets or
# exceeds wins. Matches DEFAULT_Z_BOUNDARIES in app/models/result.py
# exactly -- kept here as a fallback ONLY for callers that don't have a
# RelativeGradingRule row yet; the real source of truth is the DB.
DEFAULT_Z_BOUNDARIES: dict[str, float] = {
    "AA": 1.5,
    "AB": 1.0,
    "BB": 0.5,
    "BC": 0.0,
    "CC": -0.5,
    "CD": -1.0,
    "DD": -1.5,
}


def _population_stdev(scores: list[float], mean: float) -> float:
    """See module docstring: population stdev (÷N), not sample stdev (÷N-1)."""
    if len(scores) < 1:
        return 0.0
    variance = sum((s - mean) ** 2 for s in scores) / len(scores)
    return variance ** 0.5


def _mode(scores: list[float]) -> float | None:
    """Returns the most common score, or None if all scores are unique (no mode)."""
    if not scores:
        return None
    counts = Counter(scores)
    highest_count = max(counts.values())
    if highest_count == 1:
        return None  # every score appears exactly once -- there is no mode, not "the first value"
    # Tie among multiple modes: smallest value wins, for determinism.
    return min(value for value, count in counts.items() if count == highest_count)


def compute_cohort_statistics(scores: list[StudentScore]) -> CohortStatistics:
    if not scores:
        return CohortStatistics(mean=0.0, median=0.0, mode=None, stdev=0.0, count=0, is_zero_variance=True)

    raw = [s.raw_score for s in scores]
    mean = statistics.fmean(raw)
    median = statistics.median(raw)
    mode = _mode(raw)
    stdev = _population_stdev(raw, mean)

    return CohortStatistics(
        mean=mean,
        median=median,
        mode=mode,
        stdev=stdev,
        count=len(raw),
        is_zero_variance=(stdev == 0.0),
    )


def build_histogram(scores: list[StudentScore], bucket_width: float = 10.0) -> list[tuple[str, float, float, int]]:
    """
    Buckets raw percentage scores into fixed-width ranges for a bell-curve
    histogram (migration plan Phase 3.4: "Bell Curve, Histogram").

    Buckets are [min, max) except the final bucket, which is [min, max]
    inclusive -- so a perfect 100% score lands in the 90-100 bucket
    rather than needing a separate 100-110 bucket that would only ever
    contain the single value 100.

    Returns a list of (range_label, range_min, range_max, count) tuples,
    always covering 0 to 100 regardless of the actual score range present,
    with empty buckets included (count=0) -- a histogram with gaps
    silently omitted would misrepresent the distribution's shape.
    """
    num_buckets = math.ceil(100 / bucket_width)
    buckets = [
        (f"{int(i * bucket_width)}-{int(min((i + 1) * bucket_width, 100))}%", i * bucket_width, min((i + 1) * bucket_width, 100), 0)
        for i in range(num_buckets)
    ]
    counts = [0] * num_buckets

    for entry in scores:
        score = max(0.0, min(100.0, entry.raw_score))  # clamp defensively; raw_score should already be 0-100
        bucket_index = min(int(score // bucket_width), num_buckets - 1)
        counts[bucket_index] += 1

    return [
        (label, range_min, range_max, counts[i])
        for i, (label, range_min, range_max, _) in enumerate(buckets)
    ]


def calculate_z_score(raw_score: float, mean: float, stdev: float) -> float:
    """
    z = (score - mean) / stdev. Returns 0.0 if stdev is 0 (zero-variance
    cohort) -- see module docstring's ZERO-VARIANCE COHORTS note; callers
    should check CohortStatistics.is_zero_variance to know whether a 0.0
    z-score here means "exactly average" or "no real variance existed."
    """
    if stdev == 0:
        return 0.0
    return (raw_score - mean) / stdev


def grade_from_z_score(z: float, boundaries: dict[str, float] | None = None) -> str:
    """
    Maps a z-score to a letter grade using the given boundaries (or the
    module default). `boundaries` should be sorted highest-to-lowest by
    value internally -- this function sorts defensively so caller-supplied
    dicts (e.g. loaded from RelativeGradingRule.z_boundaries, which is
    just a JSON object with no guaranteed key order) work correctly
    regardless of insertion order.
    """
    active_boundaries = boundaries if boundaries is not None else DEFAULT_Z_BOUNDARIES
    for letter, threshold in sorted(active_boundaries.items(), key=lambda item: item[1], reverse=True):
        if z >= threshold:
            return letter
    return "F"  # below every configured boundary


def _percentile_rank(value_rank: int, count: int) -> float:
    """
    Percentile = percentage of the cohort that this student outranks or
    ties. Rank 1 (top) of 25 -> 96th percentile (24/25 scored at or below).
    Uses (count - rank) / (count - 1) * 100 for count > 1, scaled so the
    top rank approaches but doesn't necessarily hit exactly 100 unless
    they're rank 1 of 1.
    """
    if count <= 1:
        return 100.0
    return ((count - value_rank) / (count - 1)) * 100


def compute_relative_results(
    scores: list[StudentScore],
    boundaries: dict[str, float] | None = None,
) -> list[StudentResultOutput]:
    """
    The main entry point: takes raw scores for an entire cohort and
    returns z-score, letter grade, rank, and percentile for every student.

    Rank uses standard competition ranking (see module docstring): ties
    share a rank, and the next distinct score skips ahead accordingly.
    """
    if not scores:
        return []

    stats = compute_cohort_statistics(scores)
    sorted_scores = sorted(scores, key=lambda s: s.raw_score, reverse=True)

    results: list[StudentResultOutput] = []
    current_rank = 0
    previous_score: float | None = None
    for index, entry in enumerate(sorted_scores):
        if previous_score is None or entry.raw_score != previous_score:
            current_rank = index + 1  # standard competition ranking: rank = position of first tie in the group
        previous_score = entry.raw_score

        z = calculate_z_score(entry.raw_score, stats.mean, stats.stdev)
        results.append(StudentResultOutput(
            student_id=entry.student_id,
            raw_score=entry.raw_score,
            z_score=z,
            relative_grade=grade_from_z_score(z, boundaries),
            rank=current_rank,
            percentile=_percentile_rank(current_rank, stats.count),
        ))

    return results

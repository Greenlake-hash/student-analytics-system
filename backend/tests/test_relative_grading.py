"""
Tests for app/services/relative_grading.py.

Every numeric assertion below was first computed by hand or cross-checked
against a known closed-form result during development (see the module
docstring in relative_grading.py for the statistical choices these tests
pin down: population stdev, zero-variance handling, standard competition
ranking for ties).
"""
import math

from app.services.relative_grading import (
    DEFAULT_Z_BOUNDARIES,
    StudentScore,
    calculate_z_score,
    compute_cohort_statistics,
    compute_relative_results,
    grade_from_z_score,
)


# ---------------------------------------------------------------------------
# Cohort statistics
# ---------------------------------------------------------------------------

def test_statistics_match_hand_calculation():
    """scores 60,70,80,90,100 -> mean=80, population stdev=sqrt(200)≈14.142."""
    scores = [StudentScore(f"s{i}", v) for i, v in enumerate([60, 70, 80, 90, 100])]
    stats = compute_cohort_statistics(scores)

    assert stats.mean == 80.0
    assert stats.median == 80.0
    assert stats.mode is None  # every value is unique -- no mode exists
    assert math.isclose(stats.stdev, math.sqrt(200), rel_tol=1e-12)
    assert stats.count == 5
    assert stats.is_zero_variance is False


def test_population_stdev_not_sample_stdev():
    """
    Explicit regression test for the documented choice: population stdev
    (÷N) is used, not sample stdev (÷N-1). For [10, 20]: mean=15,
    population variance = ((10-15)^2+(20-15)^2)/2 = 25, stdev=5.
    Sample stdev would give variance/1 = 50, stdev≈7.07 -- a materially
    different number that would change every z-score and grade boundary.
    """
    scores = [StudentScore("a", 10), StudentScore("b", 20)]
    stats = compute_cohort_statistics(scores)
    assert stats.stdev == 5.0  # population, not sample (~7.07)


def test_mode_returns_none_when_all_scores_unique():
    scores = [StudentScore(f"s{i}", v) for i, v in enumerate([10, 20, 30])]
    assert compute_cohort_statistics(scores).mode is None


def test_mode_returns_most_common_value():
    scores = [StudentScore("a", 10), StudentScore("b", 10), StudentScore("c", 20)]
    assert compute_cohort_statistics(scores).mode == 10


def test_mode_tiebreak_is_deterministic_smallest_value():
    """Two values tied for most-common (10 appears twice, 20 appears twice) -> smaller wins."""
    scores = [StudentScore("a", 10), StudentScore("b", 10), StudentScore("c", 20), StudentScore("d", 20)]
    assert compute_cohort_statistics(scores).mode == 10


def test_empty_cohort_does_not_crash():
    stats = compute_cohort_statistics([])
    assert stats.count == 0
    assert stats.is_zero_variance is True
    assert stats.mean == 0.0


def test_zero_variance_cohort_is_flagged():
    """Every student scoring identically -> stdev=0, explicitly flagged (see module docstring)."""
    scores = [StudentScore(f"s{i}", 75.0) for i in range(5)]
    stats = compute_cohort_statistics(scores)
    assert stats.stdev == 0.0
    assert stats.is_zero_variance is True


# ---------------------------------------------------------------------------
# Z-score calculation
# ---------------------------------------------------------------------------

def test_z_score_matches_formula():
    # z = (90 - 80) / 14.142135... 
    z = calculate_z_score(90, mean=80, stdev=math.sqrt(200))
    assert math.isclose(z, 10 / math.sqrt(200), rel_tol=1e-12)


def test_z_score_at_mean_is_zero():
    assert calculate_z_score(80, mean=80, stdev=10) == 0.0


def test_z_score_returns_zero_when_stdev_is_zero():
    """Documented degenerate-case behavior, not a crash."""
    assert calculate_z_score(75, mean=75, stdev=0) == 0.0
    assert calculate_z_score(999, mean=75, stdev=0) == 0.0  # even an outlier score -> 0, per the flag-don't-guess design


# ---------------------------------------------------------------------------
# Grade boundaries
# ---------------------------------------------------------------------------

def test_grade_boundaries_are_inclusive_on_lower_edge():
    assert grade_from_z_score(1.5) == "AA"
    assert grade_from_z_score(1.4999999) == "AB"
    assert grade_from_z_score(1.0) == "AB"
    assert grade_from_z_score(0.5) == "BB"
    assert grade_from_z_score(0.0) == "BC"
    assert grade_from_z_score(-0.5) == "CC"
    assert grade_from_z_score(-1.0) == "CD"
    assert grade_from_z_score(-1.5) == "DD"


def test_grade_below_lowest_boundary_is_f():
    assert grade_from_z_score(-1.50001) == "F"
    assert grade_from_z_score(-10) == "F"


def test_grade_uses_default_boundaries_when_none_given():
    assert grade_from_z_score(2.0, boundaries=None) == "AA"


def test_grade_respects_custom_boundaries():
    """An admin can configure stricter/looser boundaries per course (migration plan: 'must be configurable')."""
    strict_boundaries = {"AA": 2.0, "AB": 1.5, "F": -100}  # much harder to get AA
    assert grade_from_z_score(1.8, boundaries=strict_boundaries) == "AB"
    assert grade_from_z_score(2.0, boundaries=strict_boundaries) == "AA"


def test_grade_boundaries_work_regardless_of_dict_key_order():
    """RelativeGradingRule.z_boundaries is a JSONB dict with no guaranteed order -- defensive sort matters."""
    unordered = {"F": -1.5, "AA": 1.5, "CC": -0.5, "BC": 0.0, "DD": -1.5, "AB": 1.0, "CD": -1.0, "BB": 0.5}
    assert grade_from_z_score(1.5, boundaries=unordered) == "AA"
    assert grade_from_z_score(0.2, boundaries=unordered) == "BC"


def test_default_boundaries_constant_matches_model_default():
    """Guards against the module-level DEFAULT_Z_BOUNDARIES drifting from app/models/result.py's copy."""
    from app.models.result import DEFAULT_Z_BOUNDARIES as model_boundaries
    assert DEFAULT_Z_BOUNDARIES == model_boundaries


# ---------------------------------------------------------------------------
# Full cohort: rank + percentile + grade together
# ---------------------------------------------------------------------------

def test_rank_uses_standard_competition_ranking_for_ties():
    """Scores 90,90,80,70,70,60 -> ranks 1,1,3,4,4,6 (no rank 2 or 5)."""
    scores = [
        StudentScore("A", 90), StudentScore("B", 90),
        StudentScore("C", 80),
        StudentScore("D", 70), StudentScore("E", 70),
        StudentScore("F", 60),
    ]
    results = {r.student_id: r for r in compute_relative_results(scores)}

    assert results["A"].rank == 1
    assert results["B"].rank == 1
    assert results["C"].rank == 3
    assert results["D"].rank == 4
    assert results["E"].rank == 4
    assert results["F"].rank == 6


def test_percentile_top_and_bottom_of_cohort():
    scores = [StudentScore(f"s{i}", v) for i, v in enumerate([100, 80, 60, 40, 20])]
    results = {r.student_id: r for r in compute_relative_results(scores)}

    assert results["s0"].percentile == 100.0  # top score, rank 1 of 5
    assert results["s4"].percentile == 0.0  # bottom score, rank 5 of 5
    assert results["s2"].percentile == 50.0  # middle, rank 3 of 5: (5-3)/(5-1)*100 = 50


def test_single_student_cohort_is_rank_one_full_percentile():
    results = compute_relative_results([StudentScore("solo", 88.0)])
    assert len(results) == 1
    assert results[0].rank == 1
    assert results[0].percentile == 100.0


def test_empty_cohort_returns_empty_results():
    assert compute_relative_results([]) == []


def test_full_cohort_result_includes_correct_grade_per_student():
    """Integration check: the full pipeline (stats -> z -> grade -> rank -> percentile) agrees internally."""
    scores = [StudentScore(f"s{i}", v) for i, v in enumerate([60, 70, 80, 90, 100])]
    results = {r.student_id: r for r in compute_relative_results(scores)}

    # mean=80, stdev=sqrt(200)≈14.142 (computed and verified above)
    assert results["s4"].relative_grade == "AB"  # score=100, z≈1.414
    assert results["s2"].relative_grade == "BC"  # score=80, z=0.0 (at the mean)
    assert results["s0"].relative_grade == "DD"  # score=60, z≈-1.414


def test_zero_variance_cohort_grades_everyone_at_bc_boundary():
    """All-identical scores -> z=0 for everyone -> BC (the boundary z=0 maps to)."""
    scores = [StudentScore(f"s{i}", 75.0) for i in range(4)]
    results = compute_relative_results(scores)
    assert all(r.relative_grade == "BC" for r in results)
    assert all(r.z_score == 0.0 for r in results)

/**
 * Types mirroring backend/app/schemas/*.py and backend/app/models/enums.py
 * exactly. Field names and casing match the JSON the API actually returns
 * (verified against the live backend during Phase 2/3 development) --
 * snake_case throughout, since that's what FastAPI/Pydantic serializes by
 * default and this app doesn't add a case-conversion layer.
 */

export type UserRole = "student" | "admin";

export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "pending_verification"
  | "approved"
  | "rejected"
  | "published";

export type VerificationStatus = "pending" | "approved" | "rejected";

export interface Me {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  trimester: number;
  credits: number;
  type: "Compulsory" | "Elective";
}

export interface Assessment {
  id: string;
  course_id: string;
  name: string;
  assessment_type: string;
  max_marks: number;
  weight: number;
  best_of_group: string;
  best_of_eligible: boolean;
  enabled: boolean;
}

export interface Submission {
  id: string;
  student_id: string;
  assessment_id: string;
  score: number | null;
  status: SubmissionStatus;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VerificationRequestRecord {
  id: string;
  submission_id: string;
  requested_by: string;
  status: VerificationStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface SubmissionWithVerification extends Submission {
  latest_verification: VerificationRequestRecord | null;
}

export interface Semester {
  id: string;
  trimester_number: number;
  is_frozen: boolean;
}

export interface CourseStatistics {
  course_id: string;
  mean: number | null;
  median: number | null;
  mode: number | null;
  stdev: number | null;
  submission_count: number;
  computed_at: string | null;
}

export interface StudentResultRow {
  student_id: string;
  course_id: string;
  raw_score: number;
  z_score: number | null;
  relative_grade: string | null;
  rank: number | null;
  percentile: number | null;
  computed_at: string;
}

export interface MyResult {
  course_id: string;
  raw_score: number;
  z_score: number | null;
  relative_grade: string | null;
  rank: number | null;
  percentile: number | null;
  computed_at: string;
}

export interface GradeDistributionBucket {
  grade: string;
  count: number;
}

export interface HistogramBucket {
  range_label: string;
  range_min: number;
  range_max: number;
  count: number;
}

export interface CourseAnalytics {
  statistics: CourseStatistics;
  grade_distribution: GradeDistributionBucket[];
  histogram: HistogramBucket[];
}

export interface CourseAnalyticsWithRoster extends CourseAnalytics {
  results: StudentResultRow[];
}

/** Standard ordering for grade letters, used to sort distribution/legend display -- best to worst. */
export const GRADE_ORDER = ["AA", "AB", "BB", "BC", "CC", "CD", "DD", "F"] as const;
export type GradeLetter = (typeof GRADE_ORDER)[number];

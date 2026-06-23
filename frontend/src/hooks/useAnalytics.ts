import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import type {
  CourseAnalytics,
  CourseAnalyticsWithRoster,
  CourseStatistics,
  MyResult,
  Semester,
} from "@/lib/types";

/** Public, aggregate-only analytics -- see backend/app/routers/analytics.py's privacy split. */
export function useCourseAnalytics(courseId: string | undefined) {
  return useQuery({
    queryKey: ["analytics", courseId],
    queryFn: () => api.get<CourseAnalytics>(`/courses/${courseId}/analytics`),
    enabled: Boolean(courseId),
    retry: (failureCount, error) => {
      // A 404 here means "not computed yet," not a transient failure -- don't retry it.
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 1;
    },
  });
}

/** Admin-only: includes the full per-student roster. */
export function useCourseAnalyticsRoster(courseId: string | undefined) {
  return useQuery({
    queryKey: ["analytics", courseId, "roster"],
    queryFn: () => api.get<CourseAnalyticsWithRoster>(`/admin/courses/${courseId}/analytics`),
    enabled: Boolean(courseId),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 1;
    },
  });
}

export function useMyResult(courseId: string | undefined) {
  return useQuery({
    queryKey: ["my-result", courseId],
    queryFn: () => api.get<MyResult>(`/courses/${courseId}/my-result`),
    enabled: Boolean(courseId),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 1;
    },
  });
}

export function useSemesters() {
  return useQuery({
    queryKey: ["admin", "semesters"],
    queryFn: () => api.get<Semester[]>("/admin/semesters"),
  });
}

export function useSetSemesterFreeze() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ trimester, isFrozen }: { trimester: number; isFrozen: boolean }) =>
      api.post<Semester>(`/admin/semesters/${trimester}/freeze`, { is_frozen: isFrozen }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "semesters"] });
    },
  });
}

export function useRecomputeCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (courseId: string) => api.post<CourseStatistics>(`/admin/courses/${courseId}/recompute`),
    onSuccess: (_data, courseId) => {
      queryClient.invalidateQueries({ queryKey: ["analytics", courseId] });
    },
  });
}

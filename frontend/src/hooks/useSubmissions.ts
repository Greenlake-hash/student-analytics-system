import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Submission, SubmissionWithVerification, Course, Assessment } from "@/lib/types";

export function useCourses() {
  return useQuery({
    queryKey: ["courses"],
    queryFn: () => api.get<Course[]>("/courses"),
  });
}

export function useAssessments(courseId: string | undefined) {
  return useQuery({
    queryKey: ["assessments", courseId],
    queryFn: () => api.get<Assessment[]>(`/courses/${courseId}/assessments`),
    enabled: Boolean(courseId),
  });
}

export function useMySubmissions() {
  return useQuery({
    queryKey: ["submissions", "mine"],
    queryFn: () => api.get<Submission[]>("/submissions/mine"),
  });
}

export function useCreateSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { assessment_id: string; score: number }) =>
      api.post<Submission>("/submissions", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions", "mine"] });
    },
  });
}

export function useRequestSubmissionUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ submissionId, ...input }: { submissionId: string; assessment_id: string; score: number }) =>
      api.post<Submission>(`/submissions/${submissionId}/request-update`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions", "mine"] });
    },
  });
}

export function useSubmitForVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (submissionId: string) => api.post(`/submissions/${submissionId}/submit-for-verification`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions", "mine"] });
    },
  });
}

export function useVerificationQueue() {
  return useQuery({
    queryKey: ["admin", "verification-queue"],
    queryFn: () => api.get<SubmissionWithVerification[]>("/admin/verification-queue"),
  });
}

export function useApproveVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ verificationId, notes }: { verificationId: string; notes?: string }) =>
      api.post(`/admin/verification-requests/${verificationId}/approve`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "verification-queue"] });
    },
  });
}

export function useRejectVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ verificationId, notes }: { verificationId: string; notes: string }) =>
      api.post(`/admin/verification-requests/${verificationId}/reject`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "verification-queue"] });
    },
  });
}

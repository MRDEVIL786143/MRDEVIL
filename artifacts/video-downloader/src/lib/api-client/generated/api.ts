import { useMutation } from "@tanstack/react-query";
import type { VideoInfoRequest, VideoInfoResponse, DownloadRequest, DownloadResponse, ErrorResponse } from "./api.schemas";

export type ErrorType<T = unknown> = T & { response?: { data?: ErrorResponse } };

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data?.error || "Request failed"), { response: { data } });
  return data as T;
}

export const useGetVideoInfo = (options?: any) =>
  useMutation<VideoInfoResponse, ErrorType<ErrorResponse>, { data: VideoInfoRequest }>({
    mutationKey: ["getVideoInfo"],
    mutationFn: ({ data }) => apiFetch("/api/video/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
    ...options?.mutation,
  });

export const useDownloadVideo = (options?: any) =>
  useMutation<DownloadResponse, ErrorType<ErrorResponse>, { data: DownloadRequest }>({
    mutationKey: ["downloadVideo"],
    mutationFn: ({ data }) => apiFetch("/api/video/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
    ...options?.mutation,
  });

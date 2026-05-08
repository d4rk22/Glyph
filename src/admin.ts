export function adminNoticeMessage(notice: string | null): string | null {
  switch (notice) {
    case "deleted":
      return "Upload deleted. R2 object deletion was requested and the metadata is marked deleted.";
    case "missing-upload":
      return "That upload no longer exists.";
    case "missing-id":
      return "No upload was selected.";
    default:
      return null;
  }
}

export function isSameOriginAdminRequest(requestUrl: string, origin: string | null): boolean {
  return !origin || origin === new URL(requestUrl).origin;
}


export function adminNoticeMessage(notice: string | null): string | null {
  switch (notice) {
    case "deleted":
      return "Upload deleted. R2 object deletion was requested and the metadata is marked deleted.";
    case "missing-upload":
      return "That upload no longer exists.";
    case "missing-id":
      return "No upload was selected.";
    case "expiration-updated":
      return "Upload expiration updated.";
    case "expiration-cleared":
      return "Upload expiration cleared.";
    case "invalid-expiration":
      return "That expiration date could not be read.";
    case "storage-cap-updated":
      return "Storage cap updated. Oldest active uploads were expired if active storage was over the cap.";
    case "storage-cap-cleared":
      return "Storage cap cleared.";
    case "invalid-storage-cap":
      return "Storage cap must be a non-negative whole number of bytes.";
    default:
      return null;
  }
}

export function isSameOriginAdminRequest(requestUrl: string, origin: string | null): boolean {
  return !origin || origin === new URL(requestUrl).origin;
}

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
    case "expiration-object-cleaned":
      return "That upload's R2 object has already been cleaned up, so its expiration cannot be changed.";
    case "storage-cap-updated":
      return "Storage cap updated. Oldest active uploads were expired if active storage was over the cap.";
    case "storage-cap-cleared":
      return "Storage cap cleared.";
    case "invalid-storage-cap":
      return "Storage cap must be a non-negative whole number of bytes.";
    case "upload-mode-updated":
      return "Upload mode updated.";
    case "invalid-upload-mode":
      return "Upload mode must be worker-mediated, direct-to-R2, or multipart direct-to-R2.";
    case "r2-cleanup-complete":
      return "R2 cleanup retry finished.";
    case "r2-cleanup-partial":
      return "R2 cleanup retried, but one or more objects still could not be deleted.";
    case "r2-cleanup-none":
      return "No expired or deleted uploads currently need R2 cleanup.";
    case "update-settings-saved":
      return "Update settings saved. Scheduled checks remain read-only and no update was run.";
    case "invalid-update-settings":
      return "Update settings must use a valid HTTPS source URL and known channel.";
    case "update-source-missing":
      return "Add a public GitHub update source before checking for updates.";
    case "maintenance-settings-saved":
      return "Scheduled maintenance settings saved. No maintenance ran from admin.";
    default:
      return null;
  }
}

export function isSameOriginAdminRequest(requestUrl: string, origin: string | null): boolean {
  return !origin || origin === new URL(requestUrl).origin;
}

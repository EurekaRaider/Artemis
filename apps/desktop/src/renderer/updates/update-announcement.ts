const announcementKey = "artemis.update.announcedVersion";

// The main process can outlive a macOS window. Persist the acknowledgement so
// recreating the renderer cannot replay that process's completed update status.
export function claimUpdateAnnouncement(version: string): boolean {
  try {
    if (window.localStorage.getItem(announcementKey) === version) return false;
    window.localStorage.setItem(announcementKey, version);
  } catch {
    // Storage availability must not prevent the application from opening.
  }
  return true;
}

import type { Messages } from "./ar";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** English translation (in progress). Missing keys fall back to Arabic. */
export const en: DeepPartial<Messages> = {
  brand: { name: "HAYAT", tagline: "A unified digital health network" },
  common: {
    save: "Save", saveDraft: "Save draft", finalize: "Finalize", cancel: "Cancel",
    close: "Close", edit: "Edit", delete: "Delete", add: "Add", search: "Search", back: "Back",
    next: "Next", confirm: "Confirm", print: "Print", download: "Download", view: "View",
    loading: "Loading…", retry: "Retry", noResults: "No results", optional: "Optional",
    required: "Required", yes: "Yes", no: "No", logout: "Sign out", settings: "Settings",
    notifications: "Notifications",
  },
  roles: {
    org_admin: "Facility admin", physician: "Physician", nurse: "Nurse",
    receptionist: "Reception", lab_staff: "Laboratory", imaging_staff: "Imaging",
  },
  recordStatus: { draft: "Draft", final: "Final", amended: "Amended",
                  entered_in_error: "Entered in error" },
};

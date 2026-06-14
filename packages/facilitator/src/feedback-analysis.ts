import type { ElementRef, FeedbackMoment, ReviewArtifact } from "@oryntra/core";

export type FeedbackScenario =
  | "filter_state_lost"
  | "drawer_instead_of_page"
  | "devices_dark_theme"
  | "dark_mode"
  | "locations_missing"
  | "change_device_site"
  | "general";

const SITE_CODES = ["NYC", "SFO", "LON"] as const;
const ORYNTRA_PARAMS = ["oryntra_session", "oryntra_api", "_oryntra_reload"];

export function shortRoute(route: string): string {
  try {
    const u = new URL(route, "http://local");
    for (const key of ORYNTRA_PARAMS) {
      u.searchParams.delete(key);
    }
    const path = u.pathname || "/";
    const keep = new URLSearchParams();
    for (const [key, value] of u.searchParams.entries()) {
      keep.set(key, value);
    }
    const qs = keep.toString();
    return qs ? `${path}?${qs}` : path;
  } catch {
    return route.split("?")[0] ?? route;
  }
}

export function humanPageName(route: string, pageTitle?: string): string {
  if (pageTitle && !/oryntra|session/i.test(pageTitle)) {
    const clean = pageTitle.replace(/\s*—\s*.+$/, "").trim();
    if (clean) return clean;
  }
  const path = shortRoute(route);
  if (path === "/" || path === "") return "Home";
  if (path.startsWith("/devices")) return "Devices";
  if (path.startsWith("/settings")) return "Settings";
  return path;
}

export function elementLabel(element: ElementRef | undefined): string | undefined {
  if (!element) return undefined;
  return element.name || element.text || element.role;
}

export function extractSiteFilter(transcript: string): string | undefined {
  for (const site of SITE_CODES) {
    if (new RegExp(`\\b${site}\\b`, "i").test(transcript)) return site;
  }
  const match = transcript.match(/\bfilter(?:ing|ed)?\s+(?:to\s+)?(\w+)/i);
  return match?.[1]?.toUpperCase();
}

function mentionsBreadcrumb(transcript: string): boolean {
  return /\bbreadcrumb/i.test(transcript);
}

function mentionsDrawer(transcript: string): boolean {
  return /\bdrawer|sheet|panel|modal|side\s*panel/i.test(transcript);
}

function mentionsFilter(transcript: string): boolean {
  return /\bfilter/i.test(transcript);
}

function mentionsViewDetails(element: ElementRef | undefined, transcript: string): boolean {
  return (
    element?.name === "View Details" ||
    /\bview\s+details\b/i.test(transcript)
  );
}

function mentionsDevicesPage(
  transcript: string,
  route: string,
  element?: ElementRef,
): boolean {
  return (
    /\bdevices?\s*page\b/i.test(transcript) ||
    shortRoute(route).startsWith("/devices") ||
    element?.name === "Devices"
  );
}

function mentionsThemeToggle(transcript: string): boolean {
  return (
    /\btoggle\b/i.test(transcript) &&
    /\bdark|light|theme|mode/i.test(transcript)
  );
}

function mentionsDarkModePolish(transcript: string): boolean {
  return (
    /\bdark\s*mode\b/i.test(transcript) &&
    /\bbad|broken|ugly|fix|looks|wrong|hard to read|contrast|really\b/i.test(
      transcript,
    )
  );
}

function mentionsLocationsMissing(transcript: string): boolean {
  return (
    /locations?/i.test(transcript) &&
    /lost|missing|empty|gone|removed|disappeared|top\s*(right|menu|nav)|nav|menu/i.test(
      transcript,
    )
  );
}

function mentionsChangeDeviceSite(transcript: string): boolean {
  return (
    /\bsite/i.test(transcript) &&
    /\b(change|switch|edit|update|assign|reassign|move)\b/i.test(transcript) &&
    /\bdevice/i.test(transcript)
  );
}

export function detectScenario(input: {
  /** Latest reviewer message only — not full chat history */
  transcript: string;
  element?: ElementRef;
  route: string;
}): FeedbackScenario {
  const { transcript, element, route } = input;
  const onDetail =
    /\/devices\/[^/?#]+/.test(shortRoute(route)) ||
    shortRoute(route).includes("/devices/");

  if (mentionsLocationsMissing(transcript)) {
    return "locations_missing";
  }
  if (mentionsChangeDeviceSite(transcript)) {
    return "change_device_site";
  }

  if (
    mentionsFilter(transcript) ||
    (mentionsViewDetails(element, transcript) && mentionsFilter(transcript)) ||
    (onDetail && mentionsFilter(transcript))
  ) {
    return "filter_state_lost";
  }
  if (
    mentionsDrawer(transcript) ||
    mentionsViewDetails(element, transcript) ||
    /\bfull\s*page\b/i.test(transcript)
  ) {
    return "drawer_instead_of_page";
  }
  if (
    mentionsDevicesPage(transcript, route, element) &&
    (mentionsDarkModePolish(transcript) ||
      mentionsThemeToggle(transcript) ||
      (/\bdark\s*mode\b/i.test(transcript) &&
        /\bfix|polish|style|toggle|switch\b/i.test(transcript)))
  ) {
    return "devices_dark_theme";
  }
  if (
    /\b(add|implement|enable|want|need)\b.*\bdark\s*mode\b/i.test(transcript) ||
    (/\bdark\s*mode\b/i.test(transcript) &&
      !mentionsDevicesPage(transcript, route, element) &&
      /\badd|implement|want|need\b/i.test(transcript))
  ) {
    return "dark_mode";
  }
  if (
    /\bdark\s*theme\b|\blight\s*mode\b|\bcolor\s*mode\b|\bcolor\s*scheme\b/i.test(
      transcript,
    ) &&
    !mentionsDevicesPage(transcript, route, element)
  ) {
    return "dark_mode";
  }
  return "general";
}

export function buildArtifactCopy(input: {
  transcript: string;
  latestMessage?: string;
  hasConversationContext?: boolean;
  moment: FeedbackMoment;
  scenario: FeedbackScenario;
}): Pick<
  import("@oryntra/core").ChangeRequest,
  "title" | "userIntent" | "currentBehavior" | "expectedBehavior"
> {
  const element =
    input.moment.spatial.lockedElement ??
    input.moment.spatial.lastClickedElement ??
    input.moment.spatial.elementUnderPointer;
  const site = extractSiteFilter(input.transcript);
  const route = shortRoute(input.moment.spatial.route);

  if (input.scenario === "filter_state_lost") {
    const sitePhrase = site ? `${site} ` : "";
    return {
      title: `Keep ${sitePhrase}device filters when opening details`,
      userIntent: input.transcript,
      currentBehavior: site
        ? `With ${site} selected, View Details navigates to a full page. Returning via Devices drops the filter and shows all devices.`
        : "List filters live only in component state — navigation clears them.",
      expectedBehavior: site
        ? `Persist filters in the URL (e.g. ?site=${site}). View Details opens a drawer so the filtered list stays visible; closing the drawer keeps ${site} selected.`
        : "Persist active filters in URL search params and open device details in a drawer instead of a full-page route.",
    };
  }

  if (input.scenario === "drawer_instead_of_page") {
    return {
      title: "Open device details in a drawer",
      userIntent: input.transcript,
      currentBehavior:
        element?.name === "View Details"
          ? "View Details navigates to a separate full page."
          : "Detail view replaces the list instead of overlaying it.",
      expectedBehavior:
        "View Details opens an in-page drawer/sheet; list context and filters remain visible underneath.",
    };
  }

  const page = humanPageName(
    input.moment.spatial.route,
    input.moment.spatial.pageTitle,
  );

  if (input.scenario === "devices_dark_theme") {
    const wantsToggle = mentionsThemeToggle(input.transcript);
    return {
      title: wantsToggle
        ? "Fix Devices dark styles + add theme toggle"
        : "Fix Devices page dark mode styles",
      userIntent: input.transcript,
      currentBehavior:
        "Dark mode works on Home/Settings, but Devices still uses light table/filter styles — poor contrast. Theme changes require Settings.",
      expectedBehavior: wantsToggle
        ? "Polish Devices page for dark mode (table, filters, selects, pills) and add a light/dark toggle in the top bar."
        : "Polish Devices page for dark mode — table, filters, selects, and status pills match the dark palette.",
    };
  }

  if (input.scenario === "dark_mode") {
    return {
      title: "Add working dark mode",
      userIntent: input.transcript,
      currentBehavior:
        "The app is light-only. Settings has a theme dropdown but it does not change the UI.",
      expectedBehavior:
        "Wire the Settings theme selector (and system preference) to a dark palette across the app.",
    };
  }

  if (input.scenario === "locations_missing") {
    return {
      title: "Restore Locations in top navigation",
      userIntent: input.transcript,
      currentBehavior:
        "Locations disappeared from the top nav; /locations may be empty or unreachable.",
      expectedBehavior:
        "Restore the Locations link in the top nav (beside Devices) and ensure /locations shows the locations overview.",
    };
  }

  if (input.scenario === "change_device_site") {
    return {
      title: "Change device site assignment",
      userIntent: input.transcript,
      currentBehavior:
        "Device site (NYC, SFO, LON) is read-only in the table and drawer.",
      expectedBehavior:
        "Let reviewers change a device's site from the device drawer (dropdown) and persist the update in the list.",
    };
  }

  const latest = (input.latestMessage ?? input.transcript).trim();
  const shortTitle =
    latest.length > 60 ? `${latest.slice(0, 57)}…` : latest;

  return {
    title: shortTitle,
    userIntent: input.transcript,
    currentBehavior: input.hasConversationContext
      ? `Current UI on ${page}; prior review messages and change requests are included in userIntent.`
      : `On ${page}, the app does not yet match what you described.`,
    expectedBehavior: input.hasConversationContext
      ? input.transcript
      : latest,
  };
}

function truncateForChat(text: string, max = 220): string {
  const flat = text.trim().replace(/\s+/g, " ");
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

export function buildConversationalReply(input: {
  moment: FeedbackMoment;
  artifact?: ReviewArtifact;
  hasConversationContext?: boolean;
}): string {
  const page = humanPageName(
    input.moment.spatial.route,
    input.moment.spatial.pageTitle,
  );

  if (input.artifact?.kind === "change_request") {
    const cr = input.artifact;
    const detail = truncateForChat(cr.expectedBehavior, 160);
    return `Got it — on **${page}**: ${cr.title.toLowerCase()}. ${detail}\n\nHit **Approve** if that matches what you want.`;
  }

  return input.hasConversationContext
    ? `What should change on **${page}**? Your latest message is in the thread above.`
    : `What should change on **${page}**? Describe what you see and what you want instead.`;
}

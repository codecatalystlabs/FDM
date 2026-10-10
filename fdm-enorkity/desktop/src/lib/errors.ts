/* Turns engine errors into plain words: what happened and what to do next. The raw message is
 * still shown underneath for anyone who wants the detail. */

export type Friendly = { title: string; hint: string; settings?: boolean };

const RULES: { test: RegExp; f: Friendly }[] = [
  { test: /drm/i, f: { title: "Protected with DRM", hint: "The owner encrypted this video, so it can only be watched on the site." } },
  { test: /yt-dlp not found|media engine unavailable/i, f: { title: "The video engine isn't installed", hint: "Install yt-dlp and ffmpeg, then retry." } },
  { test: /unsupported url|no video found/i, f: { title: "No video found on this page", hint: "Open the video's own page (not a search or home page) and copy that link." } },
  {
    test: /sign in|log ?in|private video|members[- ]only|\bage\b|age-restricted|cookies/i,
    f: {
      title: "This video needs you to be signed in",
      hint: "Sign in on the site in your browser, then turn on “Use my browser login” in Settings and retry.",
      settings: true,
    },
  },
  { test: /unavailable|removed|deleted|does not exist|not found|404/i, f: { title: "The video isn't there anymore", hint: "It was removed, made private, or the link is wrong." } },
  { test: /403|forbidden|429|too many requests/i, f: { title: "The site refused the download", hint: "This happens now and then. Retrying usually fixes it." } },
  { test: /no space|disk full|enospc/i, f: { title: "Your disk is full", hint: "Free some space or choose another download folder in Settings, then retry.", settings: true } },
  { test: /\beof\b|reset|timed? ?out|timeout|connection|network|dns|no such host/i, f: { title: "The connection dropped", hint: "Check your internet connection, then retry — it resumes where it stopped." } },
  { test: /ffmpeg|merg|postprocess/i, f: { title: "Couldn't finish the file", hint: "Joining video and audio failed. Make sure ffmpeg is installed, then retry." } },
];

export function friendlyError(raw: string | undefined | null): Friendly {
  const msg = raw ?? "";
  for (const r of RULES) if (r.test.test(msg)) return r.f;
  return { title: "Something went wrong", hint: "Retry, or check the Activity log for details." };
}
